/**
 * 싱글관제 데모의 현장 바꿔 끼우기 입구. 어느 로봇인지(?robot=<번호>, 없으면 1호기)를 정하고
 * 원본 목업 데이터(override.ts)와 로봇 움직임(drive.ts)을 이 현장으로 바꾼다.
 */
import { ROBOTS, modelKey, type RosterRobot } from '../../shared/world';
import { applyWorldOverride } from './override';
import { installDrive } from './drive';

export { overrideRequest } from './override';
export { observeRequest, onMirrorChange } from './drive';

/** 주소의 ?robot=<번호> (해시 앞). 모르는 번호면 1호기 */
export function pickRobot(search: string = window.location.search): RosterRobot {
  const id = Number(new URLSearchParams(search).get('robot'));
  return ROBOTS.find((r) => r.id === id) ?? ROBOTS[0];
}

/**
 * 원본 목업 소켓을 붙이기 전에 부른다.
 * @returns 원본 목업이 상태 추적 기록을 채운 뒤 부를 함수 (기록의 위치를 창고 통로 위로 바꾼다)
 */
export function installWorld(robot: RosterRobot): () => void {
  applyWorldOverride(robot);
  return installDrive(robot, modelKey(robot.model));
}
