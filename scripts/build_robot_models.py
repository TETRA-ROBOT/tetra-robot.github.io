#!/usr/bin/env python3
"""
소개 페이지 3D 뷰어의 로봇 모델(site/assets/models/tetra-<모델>.glb)을 ROS 로봇 설명(tetra_description)에서 다시 만든다.

  python3 scripts/build_robot_models.py <tetra_description 저장소 경로> [--out site/assets/models]

  예) python3 scripts/build_robot_models.py ../tetra_description

필요한 것
  - Python 3.10+ 와 pip 패키지: numpy trimesh pymeshlab xacro shapely mapbox_earcut scipy networkx embreex
      (만든 때의 판: numpy 2.5, trimesh 5.2, pymeshlab 2025.7, xacro 2.1, shapely 2.2, mapbox_earcut 2.1,
       scipy 1.18, networkx 3.7, embreex 4.4 — embreex 는 보이는 면 고르기의 빛줄기 계산)
      python3 -m venv /tmp/venv && /tmp/venv/bin/pip install numpy trimesh pymeshlab xacro shapely mapbox_earcut scipy networkx embreex
  - pymeshlab 의 메시 줄이기 필터는 libOpenGL 을 읽는다. 없으면 필터가 안 보인다 (Ubuntu: apt install libopengl0)
  - ROS 는 없어도 된다. xacro 의 $(find 패키지) 만 이 스크립트가 경로로 바꿔 준다.

하는 일 (모델마다)
  1. urdf/tetra_robot.urdf.xacro 를 robot_model:=<모델> 로 펼치고, 링크마다 visual 메시를 관절을 따라 base_footprint 좌표로 옮긴다.
     - S·SM 의 tetra.xacro 는 M 의 urdf/base.urdf.xacro 를 include 한다 (M 몸체가 들어가는 잘못). 모델 폴더의 base.urdf.xacro 로 바꿔 펼친다.
     - MH 는 윗판 위(control_box 아래 전부: 리프트·토르소·케이블·팬틸트·카메라)를 뺀다.
     - M 은 URDF 에 전방 라이다 메시가 없어 SICK TiM571(tim571.STL, H 와 같은 센서)을 laser 프레임에 스캔면을 맞춰 넣는다.
  2. 메시를 깨끗하게 줄인다 (부품마다):
     같은 꼭짓점 합치기 → 나사 같은 작은 조각 빼기 → 몸체에 붙은 라이다 떼기 → 평평한 면(facet)마다 작은 구멍·홈(나사 구멍·타공·
     통풍 슬롯)을 메워 큰 삼각형 몇 개로 다시 나누기 → pymeshlab quadric edge collapse(planarquadric·preserveboundary·preservenormal·
     preservetopology)로 줄이기 → 모델 전체에서 밖으로 빛줄기가 빠져나가지 못하는 작은 면(몸체 속 부품, 판 속에 갇힌 구멍 벽, 바닥 면) 지우기.
     예전 STL 은 꼭짓점 묶기(vertex clustering)로 줄여 평평한 판에 구멍·톱니가 생기고 얇은 부분(M 전방 라이다, S 라이다 칸)이 사라졌다.
  3. 색을 부분마다 나눈다 (glb 재질 이름 = 화면이 쓰는 이름):
     body(어두운 회색) · band(빨강: 윗판 바로 아래 라이다 칸의 옆면) · lidar(검정) · wheel(거의 검정) · rim(밝은 휠 림)
     빨간 띠의 높이는 짐작하지 않고 몸체 모양에서 찾는다: 가장 높은 넓은 아랫면(윗판 밑면)과 그 아래 가장 가까운 넓은 윗면(그 아래 판의 윗면)
     사이. 그 칸에 URDF 의 라이다 프레임(laser·lidar)이 있는지 확인해 찍어 준다.
  4. 바닥에 닿게 맞춘다 (EDU·SM·H 는 URDF base_joint 높이가 바퀴 반지름과 달라 1.5~2.5 cm 떠 있다).
  결과: 단위 m, ROS 좌표(앞 +x, 왼쪽 +y, 위 +z). 화면이 x 축으로 -90° 돌려 바닥을 y=0 에 둔다. 법선은 넣지 않는다(화면이 각진 법선을 만든다).
"""
import argparse
import os
import re
import shutil
import tempfile
import xml.etree.ElementTree as ET

import numpy as np
import trimesh
import pymeshlab as ml
from shapely.geometry import Polygon
from shapely.ops import unary_union
import mapbox_earcut as earcut
import xacro
import xacro.substitution_args as xsub

# 화면 색 (sRGB). 몸체는 예전 화면의 0x3b4048, 빨강은 TETRA 빨강 0xc8102e
COLORS = {
    'body': (0x3b, 0x40, 0x48),
    'band': (0xc8, 0x10, 0x2e),
    'lidar': (0x1c, 0x1e, 0x22),
    'wheel': (0x15, 0x17, 0x1b),
    'rim': (0xa9, 0xb0, 0xb8),
}

# 모델별 설정. 띠 높이·바퀴 자리는 여기 쓰지 않고 URDF·메시에서 구한다
MODELS = {
    'm': {'add_tim571': ['laser']},  # 전방 SICK 라이다는 메시가 없어 넣는다 (후방 laser_link2 자리의 작은 센서는 몸체 메시에 있다)
    'h': {},
    'edu': {},
    'mh': {'drop_subtree': 'control_box'},
    's': {'body_target': 30000},  # S 몸체는 곡면·부품이 많아 12000 까지 줄이면 판이 접혀 구멍이 난다
    'sm': {},
}
SMALL_PART_DIAG = 0.012     # 이보다 작은 조각(나사·와셔·작은 커넥터)은 뺀다 (m)
MAX_HOLE_AREA = 0.001       # 평평한 면에서 메울 구멍·오목한 홈 크기 상한 (10 cm²: 나사 구멍·타공·통풍 슬롯·작은 홈. 손잡이·라이다 창 같은 큰 것은 남김)
TARGET_FACES = {'body': 12000, 'wheel': 1200, 'lidar': 600, 'caster': 700}   # 줄이기 목표 삼각형 수 (부품 하나)
KEEP_FACE_AREA = 0.0025     # 보이는 면 고르기에서 이보다 넓은 면(25 cm²)은 안 보여도 남긴다
TIM571_SCAN = np.array([0.031, 0.063, 0.030])  # tim571.STL 좌표에서 광학 머리 중심(스캔면). 메시 y 가 위쪽


# ---------------------------------------------------------------- URDF

def rpy_matrix(roll, pitch, yaw):
    cr, sr, cp, sp, cy, sy = np.cos(roll), np.sin(roll), np.cos(pitch), np.sin(pitch), np.cos(yaw), np.sin(yaw)
    rx = np.array([[1, 0, 0], [0, cr, -sr], [0, sr, cr]])
    ry = np.array([[cp, 0, sp], [0, 1, 0], [-sp, 0, cp]])
    rz = np.array([[cy, -sy, 0], [sy, cy, 0], [0, 0, 1]])
    return rz @ ry @ rx


def origin_transform(element):
    tf = np.eye(4)
    if element is None:
        return tf
    tf[:3, :3] = rpy_matrix(*[float(v) for v in element.get('rpy', '0 0 0').split()])
    tf[:3, 3] = [float(v) for v in element.get('xyz', '0 0 0').split()]
    return tf


def expand_urdf(description_root, model):
    """원본은 건드리지 않고 임시 폴더에 urdf 를 복사해 펼친다 (S·SM include 경로만 고침)"""
    tmp = tempfile.mkdtemp()
    try:
        packages = {'tetra_description': os.path.join(tmp, 'tetra_description'),
                    'herkulex_description': os.path.join(description_root, 'herkulex_description')}
        shutil.copytree(os.path.join(description_root, 'tetra_description', 'urdf'), os.path.join(tmp, 'tetra_description', 'urdf'))
        for sub in ('tetra_s', 'tetra_sm'):
            path = os.path.join(tmp, 'tetra_description', 'urdf', sub, 'tetra.xacro')
            with open(path) as f:
                text = f.read()
            with open(path, 'w') as f:
                f.write(text.replace('urdf/base.urdf.xacro', f'urdf/{sub}/base.urdf.xacro'))
        find = lambda pkg: packages[pkg]
        xsub._eval_find = find
        xsub._eval_dict['find'] = find
        doc = xacro.process_file(os.path.join(packages['tetra_description'], 'urdf', 'tetra_robot.urdf.xacro'),
                                 mappings={'robot_model': model})
        return doc.toxml()
    finally:
        shutil.rmtree(tmp)


def urdf_parts(description_root, model):
    """visual 메시 목록(base_footprint 기준 변환)과 링크 프레임 자리"""
    root = ET.fromstring(expand_urdf(description_root, model))
    joints = {j.find('child').get('link'): (j.find('parent').get('link'), origin_transform(j.find('origin')))
              for j in root.findall('joint')}

    def chain(link):
        tf, ancestors = np.eye(4), []
        while link != 'base_footprint':
            parent, joint_tf = joints[link]
            tf = joint_tf @ tf
            ancestors.append(link)
            link = parent
        return tf, ancestors

    frames = {link: chain(link)[0] for link in joints}
    packages = {'tetra_description': os.path.join(description_root, 'tetra_description'),
                'herkulex_description': os.path.join(description_root, 'herkulex_description')}
    parts = []
    for link in root.findall('link'):
        for visual in link.findall('visual'):
            mesh = visual.find('geometry/mesh')
            if mesh is None:
                continue
            pkg, rel = re.match(r'package://([^/]+)/(.*)', mesh.get('filename')).groups()
            tf, ancestors = chain(link.get('name'))
            parts.append({'link': link.get('name'), 'ancestors': ancestors,
                          'path': os.path.normpath(os.path.join(packages[pkg], rel)),
                          'scale': [float(s) for s in mesh.get('scale', '1 1 1').split()],
                          'tf': tf @ origin_transform(visual.find('origin'))})
    return parts, frames


def classify_part(part):
    name = os.path.basename(part['path']).lower()
    if 'tim571' in name:
        return 'lidar'
    if 'caster' in name:
        return 'caster'
    if 'wheel' in name:
        return 'wheel'
    return 'body'


# ---------------------------------------------------------------- 메시 다듬기

def to_meshset(mesh):
    ms = ml.MeshSet()
    ms.add_mesh(ml.Mesh(vertex_matrix=np.asarray(mesh.vertices, float), face_matrix=np.asarray(mesh.faces, np.int32)))
    return ms


def from_meshset(ms):
    cur = ms.current_mesh()
    return trimesh.Trimesh(cur.vertex_matrix(), cur.face_matrix(), process=False)


def boundary_edge_count(mesh):
    merged = mesh.copy()
    merged.merge_vertices()
    return len(trimesh.grouping.group_rows(merged.edges_sorted, require_count=1))


def clean(mesh, min_diag):
    ms = to_meshset(mesh)
    ms.meshing_merge_close_vertices(threshold=ml.PureValue(2e-5))
    ms.meshing_remove_duplicate_faces()
    ms.meshing_remove_null_faces()
    ms.meshing_remove_unreferenced_vertices()
    if min_diag:
        ms.meshing_remove_connected_component_by_diameter(mincomponentdiag=ml.PureValue(min_diag))
    return from_meshset(ms)


def plane_basis(normal):
    helper = np.array([1.0, 0, 0]) if abs(normal[0]) < 0.9 else np.array([0, 1.0, 0])
    u = np.cross(normal, helper)
    u /= np.linalg.norm(u)
    return u, np.cross(normal, u)


def triangulate_rings(coords, ends):
    """다각형(바깥 + 남긴 큰 구멍)을 새 꼭짓점 없이 earcut 으로 나눈다"""
    return np.asarray(earcut.triangulate_float64(coords, np.array(ends, np.uint32)), int).reshape(-1, 3)


def retriangulate_facet(vertices, faces, facet, normal, hole_vertices):
    """평평한 면 하나: 삼각형을 합친 다각형에서 작은 구멍을 지우고 earcut 으로 다시 나눈다.
    둘레 꼭짓점은 모두 그대로 써서 옆 면과 틈(T 이음)이 생기지 않게 한다.
    바꿀 것이 없거나(구멍 없고 삼각형도 줄지 않음) 다각형을 못 만들면 None"""
    u, w = plane_basis(normal)
    origin = vertices[faces[facet[0], 0]]
    ids = np.unique(faces[facet])
    flat = {int(v): (float((vertices[v] - origin) @ u), float((vertices[v] - origin) @ w)) for v in ids}
    try:
        shape = unary_union([Polygon([flat[int(a)] for a in faces[f]]).buffer(0) for f in facet])
    except Exception:
        return None
    lookup = {(round(x, 7), round(y, 7)): v for v, (x, y) in flat.items()}
    triangles, changed = [], False
    for poly in (shape.geoms if shape.geom_type == 'MultiPolygon' else [shape]):
        if poly.is_empty:
            continue
        rings = [poly.exterior]
        for ring in poly.interiors:
            if Polygon(ring).area < MAX_HOLE_AREA:
                changed = True
                hole_vertices.update(lookup.get((round(x, 7), round(y, 7)), -1) for x, y in ring.coords)
            else:
                rings.append(ring)
        ring_ids, coords, ends = [], [], []
        for ring in rings:
            for x, y in list(ring.coords)[:-1]:
                v = lookup.get((round(x, 7), round(y, 7)))
                if v is None:
                    return None
                ring_ids.append(v)
                coords.append((x, y))
            ends.append(len(coords))
        triangles.append(np.array(ring_ids)[triangulate_rings(np.array(coords, float), ends)])
    if not triangles:
        return None
    tri = np.vstack(triangles)
    cross = np.cross(vertices[tri[:, 1]] - vertices[tri[:, 0]], vertices[tri[:, 2]] - vertices[tri[:, 0]])
    flip = cross @ normal < 0
    tri[flip] = tri[flip][:, ::-1]
    if not changed and len(tri) >= len(facet):
        return None
    return tri


def fill_small_holes(mesh):
    """평평한 면마다 작은 구멍을 메운다. 원통 구멍의 벽(꼭짓점이 모두 메운 구멍 둘레에 있는 면)은 같이 지운다.
    그 밖의 벽 조각은 판 속에 갇히고, 뒤의 보이는 면 고르기(visible_faces)에서 빠진다.
    (벽을 열린 모서리부터 이웃으로 번지며 벗겨 내는 방법은 곡면까지 갉아먹어 SM 을 망가뜨렸다.
     보이는 면 고르기를 줄이기 뒤에 하는 것도 같은 까닭: 지워서 생긴 열린 모서리가 많으면 quadric 줄이기가 판을 접어 구멍을 냈다)"""
    vertices, faces = mesh.vertices, mesh.faces
    keep = np.ones(len(faces), bool)
    added, hole_vertices = [], set()
    for facet, normal in zip(mesh.facets, mesh.facets_normal):
        if len(facet) < 2:
            continue
        tri = retriangulate_facet(vertices, faces, facet, normal, hole_vertices)
        if tri is None:
            continue
        keep[facet] = False
        added.append(tri)
    faces = np.vstack([faces[keep]] + added) if added else faces
    if hole_vertices:
        on_hole = np.zeros(len(vertices), bool)
        on_hole[[v for v in hole_vertices if v >= 0]] = True
        faces = faces[~on_hole[faces].all(axis=1)]
    out = trimesh.Trimesh(vertices, faces, process=False)
    out.remove_unreferenced_vertices()
    return out


def hemisphere_directions(count):
    """위쪽 반구(수평보다 조금 아래까지)에 고르게 퍼진 방향. 화면의 카메라는 늘 바닥 위에 있다"""
    i = np.arange(count) + 0.5
    z = 1 - i / count * 1.05          # 1 → -0.05
    r = np.sqrt(np.clip(1 - z * z, 0, 1))
    phi = i * np.pi * (3 - np.sqrt(5))
    return np.stack([r * np.cos(phi), r * np.sin(phi), z], axis=1)


def visible_faces(meshes, floor_z, directions=320):
    """모델 전체를 놓고, 면마다 바깥(카메라가 있을 수 있는 곳)으로 빠져나가는 빛줄기가 하나라도 있으면 보이는 면.
    판 속에 갇힌 구멍 벽, 몸체 속 부품, 판의 안쪽 면, 바닥에 깔린 면을 지운다.
    면마다 가운데와 세 꼭짓점 쪽 네 점에서, 면의 앞·뒤 양쪽으로 쏜다 (CAD 면 방향이 뒤집혀 있어도 지우지 않게)"""
    allmesh = trimesh.util.concatenate(meshes)
    lo, hi = allmesh.bounds
    pad = np.linalg.norm(hi - lo)
    floor = trimesh.Trimesh([[lo[0] - pad, lo[1] - pad, floor_z], [hi[0] + pad, lo[1] - pad, floor_z],
                             [hi[0] + pad, hi[1] + pad, floor_z], [lo[0] - pad, hi[1] + pad, floor_z]], [[0, 1, 2], [0, 2, 3]])
    scene = trimesh.util.concatenate([allmesh, floor])
    caster = trimesh.ray.ray_pyembree.RayMeshIntersector(scene)
    tri, normal = allmesh.triangles, allmesh.face_normals
    center = tri.mean(axis=1)
    samples = [center] + [0.75 * tri[:, k] + 0.25 * center for k in range(3)]
    origins = np.concatenate([s + side * 4e-4 * normal for s in samples for side in (1, -1)])   # (8·면수, 3)
    owner = np.tile(np.arange(len(tri)), 8)
    seen = np.zeros(len(tri), bool)
    for direction in hemisphere_directions(directions):
        todo = ~seen[owner]
        if not todo.any():
            break
        hit = caster.intersects_any(origins[todo], np.broadcast_to(direction, (int(todo.sum()), 3)))
        seen[owner[todo][~hit]] = True
    # 큰 면은 안 보인다고 나와도 남긴다: 몸체 속 큰 판(옆판 안쪽 등)은 좁은 틈(카메라 창 등)으로 아주 작은 각도에서만 보여
    # 빛줄기가 놓치기 쉽고, 지우면 그 틈으로 뒤 배경이 비친다. 큰 면은 개수가 적어 남겨도 파일이 거의 늘지 않는다
    seen |= allmesh.area_faces >= KEEP_FACE_AREA
    out, start = [], 0
    for m in meshes:
        out.append(seen[start:start + len(m.faces)])
        start += len(m.faces)
    return out


def decimate(mesh, target):
    """quadric edge collapse: 평면은 평면대로(planarquadric), 모양·위상·열린 모서리는 지키며 곡면을 줄인다"""
    if len(mesh.faces) <= target:
        return mesh
    ms = to_meshset(mesh)
    ms.meshing_decimation_quadric_edge_collapse(targetfacenum=int(target), qualitythr=0.3, preserveboundary=True, boundaryweight=2.0,
                                                preservenormal=True, preservetopology=True, optimalplacement=False,
                                                planarquadric=True, planarweight=0.001, autoclean=True)
    return from_meshset(ms)


def split_sensors(body, sensor_points):
    """몸체 메시에 붙어 있는 라이다(작은 덩어리 중 URDF 라이다 프레임을 감싸는 것)를 떼어 검정으로 칠한다"""
    pieces = body.split(only_watertight=False)
    sensors, rest = [], []
    for piece in pieces:
        lo, hi = piece.bounds
        is_sensor = np.linalg.norm(hi - lo) < 0.2 and any(np.all(lo - 0.01 <= p) and np.all(p <= hi + 0.01) for p in sensor_points)
        (sensors if is_sensor else rest).append(piece)
    merge = lambda ms: trimesh.util.concatenate(ms) if ms else None
    return merge(rest), merge(sensors)


# ---------------------------------------------------------------- 빨간 띠·바퀴 찾기

def horizontal_levels(mesh, sign):
    """윗면(sign=+1)·아랫면(-1)이 넓게 모인 높이(1 mm 단위)와 넓이"""
    up = mesh.face_normals[:, 2] * sign > 0.98
    levels = {}
    for z, area in zip(np.round(mesh.triangles_center[up, 2], 3), mesh.area_faces[up]):
        levels[z] = levels.get(z, 0.0) + area
    return levels


def find_band(body, sensor_heights):
    """윗판 밑면과 그 아래 판의 윗면 사이 = 라이다 칸. 넓은 면 = 가장 넓은 수평면의 25% 이상"""
    downs, ups = horizontal_levels(body, -1), horizontal_levels(body, +1)
    largest = max(max(downs.values()), max(ups.values()))
    hi = max(z for z, a in downs.items() if a > 0.25 * largest)
    lo = max(z for z, a in ups.items() if a > 0.25 * largest and z < hi - 0.01)
    inside = [float(h) for h in sensor_heights if lo <= h <= hi]
    return float(lo), float(hi), inside


def slice_z(mesh, lo, hi):
    """lo·hi 평면으로 잘라 아래·띠·위 세 조각 (잘린 모서리는 양쪽이 같은 점을 써서 틈이 없다)"""
    from trimesh.intersections import slice_mesh_plane
    below = slice_mesh_plane(mesh, [0, 0, -1], [0, 0, lo])
    rest = slice_mesh_plane(mesh, [0, 0, 1], [0, 0, lo])
    band = slice_mesh_plane(rest, [0, 0, -1], [0, 0, hi])
    above = slice_mesh_plane(rest, [0, 0, 1], [0, 0, hi])
    return below, band, above


def wheel_regions(frames, ground):
    """URDF 바퀴 관절(base_*_wheel_link) 자리: 축 높이 - 바닥 = 반지름"""
    out = []
    for link, tf in frames.items():
        if re.match(r'base_[lr]_wheel_link$', link):
            center = tf[:3, 3].copy()
            out.append((center, center[2] - ground))
    return out


def rim_mask(mesh, center, radius):
    """바퀴 안쪽(세 꼭짓점이 모두 반지름의 70% 안) = 휠 림. 타이어는 그대로 검정"""
    v = mesh.vertices[mesh.faces]
    radial = np.hypot(v[..., 0] - center[0], v[..., 2] - center[2])
    return (radial < 0.7 * radius).all(axis=1)


def submesh(mesh, mask):
    out = trimesh.Trimesh(mesh.vertices, mesh.faces[mask], process=False)
    out.remove_unreferenced_vertices()
    return out


# ---------------------------------------------------------------- 모델 만들기

def linear_color(srgb):
    """glTF 의 baseColorFactor 는 선형 색이다. 화면 색(sRGB 0~255)을 바꿔 넣어야 three.js 에서 같은 색으로 보인다"""
    c = np.array(srgb, float) / 255
    lin = np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)
    return [float(v) for v in lin] + [1.0]


def tim571_part(description_root, frame_tf):
    """TiM571 메시를 laser 프레임에: 메시 y(위) → z, 센서 앞을 프레임 x 로, 스캔면 중심을 프레임 원점에"""
    rot = np.eye(4)
    rot[:3, :3] = frame_tf[:3, :3] @ rpy_matrix(0, 0, -np.pi / 4) @ rpy_matrix(np.pi / 2, 0, 0)
    rot[:3, 3] = frame_tf[:3, 3] - rot[:3, :3] @ TIM571_SCAN
    return {'link': 'added_tim571', 'path': os.path.join(description_root, 'tetra_description', 'meshes', 'tim571.STL'),
            'scale': [0.001] * 3, 'tf': rot, 'ancestors': []}


def write_glb(path, named_meshes):
    """작은 glb: 메시(=재질)마다 위치(float32)와 삼각형 번호(꼭짓점이 65536 개 미만이면 uint16)만 넣는다.
    법선·텍스처 좌표는 넣지 않는다 (화면이 만든다)"""
    import json, struct
    blob, views, accessors, meshes, materials, nodes = bytearray(), [], [], [], [], []

    def add_view(data, target):
        while len(blob) % 4:
            blob.append(0)
        views.append({'buffer': 0, 'byteOffset': len(blob), 'byteLength': len(data), 'target': target})
        blob.extend(data)
        return len(views) - 1

    for name, mesh in named_meshes:
        pos = np.asarray(mesh.vertices, np.float32)
        idx = np.asarray(mesh.faces).reshape(-1)
        idx = idx.astype(np.uint16) if len(pos) < 65536 else idx.astype(np.uint32)
        accessors.append({'bufferView': add_view(pos.tobytes(), 34962), 'componentType': 5126, 'count': len(pos), 'type': 'VEC3',
                          'min': pos.min(axis=0).tolist(), 'max': pos.max(axis=0).tolist()})
        accessors.append({'bufferView': add_view(idx.tobytes(), 34963), 'componentType': 5123 if idx.dtype == np.uint16 else 5125,
                          'count': len(idx), 'type': 'SCALAR'})
        materials.append({'name': name, 'pbrMetallicRoughness': {'baseColorFactor': linear_color(COLORS[name]),
                                                                  'metallicFactor': 0.0, 'roughnessFactor': 0.6}})
        meshes.append({'name': name, 'primitives': [{'attributes': {'POSITION': len(accessors) - 2}, 'indices': len(accessors) - 1,
                                                     'material': len(materials) - 1}]})
        nodes.append({'name': name, 'mesh': len(meshes) - 1})
    while len(blob) % 4:
        blob.append(0)
    doc = {'asset': {'version': '2.0', 'generator': 'tetra-site scripts/build_robot_models.py'},
           'scene': 0, 'scenes': [{'nodes': list(range(len(nodes)))}], 'nodes': nodes, 'meshes': meshes, 'materials': materials,
           'accessors': accessors, 'bufferViews': views, 'buffers': [{'byteLength': len(blob)}]}
    text = json.dumps(doc, separators=(',', ':')).encode()
    text += b' ' * (-len(text) % 4)
    with open(path, 'wb') as f:
        f.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(blob)))
        f.write(struct.pack('<II', len(text), 0x4E4F534A) + text)
        f.write(struct.pack('<II', len(blob), 0x004E4942) + bytes(blob))


def build_model(description_root, key, out_dir):
    config = MODELS[key]
    parts, frames = urdf_parts(description_root, key)
    if config.get('drop_subtree'):
        parts = [p for p in parts if config['drop_subtree'] not in p['ancestors']]
    for frame in config.get('add_tim571', []):
        parts.append(tim571_part(description_root, frames[frame]))

    sensor_frames = [tf[:3, 3] for link, tf in frames.items() if re.search(r'laser|lidar', link) and 'merge' not in link]

    # 1) 부품마다: 꼭짓점 합치기·작은 조각 빼기 → 몸체에 붙은 라이다 떼기 → 평평한 면의 작은 구멍 메우기 → 줄이기
    report = {'model': key, 'parts': []}
    pieces = []   # [색 종류, 메시, 보고 항목]
    for part in parts:
        source = trimesh.load(part['path'], process=False)
        source.apply_scale(part['scale'])
        source.apply_transform(part['tf'])
        kind = classify_part(part)
        entry = {'file': os.path.basename(part['path']), 'link': part['link'], 'kind': kind,
                 'tris_in': len(source.faces), 'open_in': boundary_edge_count(clean(source, 0)), 'tris_out': 0}
        report['parts'].append(entry)
        cleaned = clean(source, SMALL_PART_DIAG if kind == 'body' else 0.004)
        found = [(kind, cleaned)]
        if kind == 'body':
            rest, sensors = split_sensors(cleaned, sensor_frames)
            found = [('body', rest)] + ([('lidar', sensors)] if sensors is not None else [])
        for sub_kind, mesh in found:
            target = config.get('body_target', TARGET_FACES['body']) if sub_kind == 'body' else TARGET_FACES[sub_kind]
            small = decimate(fill_small_holes(mesh), target)
            entry['open_mid'] = entry.get('open_mid', 0) + boundary_edge_count(small)
            pieces.append([sub_kind, small, entry])

    ground = min(m.bounds[0][2] for _, m, _ in pieces)
    report['ground_shift'] = -ground

    # 빨간 띠 높이는 지우기 전 몸체 모양에서 찾는다 (판 밑면처럼 가려진 면도 넓이를 세야 해서)
    body_all = trimesh.util.concatenate([m for k, m, _ in pieces if k == 'body'])
    lo, hi, inside = find_band(body_all, [p[2] for p in sensor_frames])

    # 2) 보이지 않는 면 지우기 (줄인 뒤에: 지워서 생긴 열린 모서리가 줄이기를 묶지 않게)
    keep = visible_faces([m for _, m, _ in pieces], ground)
    for piece, mask in zip(pieces, keep):
        kind, mesh, entry = piece
        mesh = submesh(mesh, mask)
        mesh.apply_translation([0, 0, -ground])  # 바닥에 닿게
        piece[1] = mesh
        entry['tris_out'] += len(mesh.faces)
        entry.setdefault('meshes', []).append(mesh)
    for entry in report['parts']:
        entry['open_out'] = boundary_edge_count(trimesh.util.concatenate(entry.pop('meshes')))

    merged = {}
    for kind, mesh, _ in pieces:
        merged.setdefault('wheel' if kind == 'caster' else kind, []).append(mesh)
    merged = {k: trimesh.util.concatenate(v) for k, v in merged.items()}

    # 3) 빨간 띠: 그 높이의 옆면 (라이다는 따로 떼어 두었으니 띠에 들지 않는다)
    lo, hi = lo - ground, hi - ground
    report['band'] = (lo, hi, [round(float(h - ground), 3) for h in inside])
    below, band, above = slice_z(merged['body'], lo, hi)
    red = np.abs(band.face_normals[:, 2]) < 0.5
    regions = {'body': [below, above, submesh(band, ~red)], 'band': [submesh(band, red)],
               'wheel': [], 'rim': [], 'lidar': [merged['lidar']] if 'lidar' in merged else []}

    # 4) 바퀴: 따로 그린 바퀴는 통째로, 몸체에 붙은 바퀴(EDU·SM·MH)는 URDF 바퀴 자리 원통 안의 면. 안쪽은 밝은 림
    wheels = [(c - [0, 0, ground], r) for c, r in wheel_regions(frames, ground)]
    if 'wheel' in merged:
        rim = np.zeros(len(merged['wheel'].faces), bool)
        for center, radius in wheels:
            near = np.abs(merged['wheel'].triangles_center[:, 1] - center[1]) < 0.05
            rim |= near & rim_mask(merged['wheel'], center, radius)
        regions['wheel'].append(submesh(merged['wheel'], ~rim))
        regions['rim'].append(submesh(merged['wheel'], rim))
    elif wheels:
        body_parts = []
        for piece in regions['body']:
            in_wheel = np.zeros(len(piece.faces), bool)
            rim = np.zeros(len(piece.faces), bool)
            for center, radius in wheels:
                # 세 꼭짓점이 모두 바퀴 원통 안인 면만 (옆판의 큰 삼각형이 걸리지 않게)
                v = piece.vertices[piece.faces]
                radial = np.hypot(v[..., 0] - center[0], v[..., 2] - center[2])
                cyl = ((np.abs(v[..., 1] - center[1]) < 0.035) & (radial < radius + 0.004)).all(axis=1)
                in_wheel |= cyl
                rim |= cyl & rim_mask(piece, center, radius)
            body_parts.append(submesh(piece, ~in_wheel))
            regions['wheel'].append(submesh(piece, in_wheel & ~rim))
            regions['rim'].append(submesh(piece, rim))
        regions['body'] = body_parts

    named = []
    for name, chunks in regions.items():
        chunks = [c for c in chunks if len(c.faces)]
        if not chunks:
            continue
        mesh = trimesh.util.concatenate(chunks)
        mesh.merge_vertices()
        named.append((name, mesh))
        report.setdefault('faces', {})[name] = len(mesh.faces)
    path = os.path.join(out_dir, f'tetra-{key}.glb')
    write_glb(path, named)
    report['bytes'] = os.path.getsize(path)
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n')[1])
    parser.add_argument('description_root', help='tetra_description 저장소 (tetra_description/·herkulex_description/ 가 있는 폴더)')
    parser.add_argument('--out', default=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'site', 'assets', 'models'))
    parser.add_argument('--only', nargs='*', default=list(MODELS))
    args = parser.parse_args()
    os.makedirs(args.out, exist_ok=True)
    for key in args.only:
        rep = build_model(os.path.abspath(args.description_root), key, args.out)
        lo, hi, inside = rep['band']
        print(f"tetra-{key}.glb  {rep['bytes'] / 1024:.0f} KB  면 {rep['faces']}  바닥 맞춤 {rep['ground_shift'] * 100:+.1f} cm")
        print(f"  빨간 띠 z {lo:.3f}~{hi:.3f} m (그 칸의 라이다 프레임 높이: {inside or '없음'})")
        for p in rep['parts']:
            print(f"  {p['file']:28s} {p['kind']:6s} 삼각형 {p['tris_in']:7d} → {p['tris_out']:6d}   열린 모서리 {p['open_in']:4d} → 줄인 뒤 {p['open_mid']:4d} → 안 보이는 면 지운 뒤 {p['open_out']:4d}")


if __name__ == '__main__':
    main()
