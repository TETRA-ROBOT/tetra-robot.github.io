/** 데모 표시 띠 (원본 화면은 고치지 않고 body 에 붙인다) */
const STYLE = `
#tetra-demo-banner{position:fixed;left:50%;bottom:6px;transform:translateX(-50%);z-index:2147483000;
  display:flex;align-items:center;gap:10px;padding:4px 6px 4px 12px;border-radius:999px;
  background:rgba(33,33,33,.82);color:#fff;font:12px/1.4 system-ui,-apple-system,"Segoe UI","Noto Sans KR",sans-serif;
  box-shadow:0 2px 8px rgba(0,0,0,.25);backdrop-filter:blur(4px);max-width:calc(100vw - 24px);white-space:nowrap}
#tetra-demo-banner .dot{transition:background .3s;width:7px;height:7px;border-radius:50%;background:#FFB300;flex:none}
#tetra-demo-banner .msg{overflow:hidden;text-overflow:ellipsis}
#tetra-demo-banner a,#tetra-demo-banner button{color:#80DEEA;text-decoration:none;background:none;border:0;cursor:pointer;font:inherit;padding:2px 6px;border-radius:999px}
#tetra-demo-banner a:hover,#tetra-demo-banner button:hover{background:rgba(255,255,255,.12)}
#tetra-demo-banner.min .msg,#tetra-demo-banner.min a{display:none}
`;

const ownText = (robotName: string): string => `데모 모드 · ${robotName} (가상 데이터) — 실제 로봇과 연결되지 않습니다`;

/**
 * @param robotName 이 데모가 보여 주는 로봇 이름
 * @returns 문구 바꾸기: 멀티관제 데모 탭의 같은 로봇을 따라 하는 동안(mirroring)은 그렇다고 알린다
 */
export function mountDemoBanner(robotName: string): (mirroring: boolean) => void {
  const style = document.createElement('style');
  style.textContent = STYLE;
  document.head.appendChild(style);
  const banner = document.createElement('div');
  banner.id = 'tetra-demo-banner';
  banner.setAttribute('role', 'note');
  banner.innerHTML = '<span class="dot"></span><span class="msg"></span>'
    + '<a href="../">← 소개 페이지</a><button type="button" title="접기/펴기" aria-label="접기/펴기">–</button>';
  const message = banner.querySelector<HTMLElement>('.msg')!;
  const dot = banner.querySelector<HTMLElement>('.dot')!;
  message.textContent = ownText(robotName);
  banner.querySelector('button')!.addEventListener('click', (event) => {
    const min = banner.classList.toggle('min');
    (event.currentTarget as HTMLButtonElement).textContent = min ? '데모' : '–';
  });
  document.body.appendChild(banner);
  return (mirroring: boolean) => {
    message.textContent = mirroring ? `멀티관제 데모의 ${robotName} 를 따라 보여 줍니다` : ownText(robotName);
    // 따라 하는 동안은 초록 점 (멀티관제와 이어져 있음)
    dot.style.background = mirroring ? '#66BB6A' : '';
  };
}
