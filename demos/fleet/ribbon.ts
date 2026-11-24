/**
 * 화면 아래 가운데에 작게 띄우는 데모 안내 띠 (원본 화면 위에 덧붙임). 랜딩 페이지(../)로 가는 링크.
 */
const TEXT = '데모 모드 · 브라우저 시뮬레이션 — 실제 로봇과 연결되지 않습니다';

export function mountDemoRibbon() {
  const style = document.createElement('style');
  style.textContent = `
    #tetra-demo-ribbon {
      position: fixed; left: 50%; bottom: 8px; transform: translateX(-50%); z-index: 3000;
      display: flex; align-items: center; gap: 10px; max-width: calc(100vw - 32px);
      padding: 5px 12px; border-radius: 999px; font: 500 12px/1.4 'Pretendard', system-ui, sans-serif;
      color: #fff; background: rgba(20, 22, 30, 0.82); border: 1px solid rgba(248, 182, 44, 0.65);
      box-shadow: 0 2px 10px rgba(0,0,0,0.35); backdrop-filter: blur(4px); pointer-events: auto;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    #tetra-demo-ribbon .dot { width: 7px; height: 7px; border-radius: 50%; background: #f8b62c; flex: none; }
    #tetra-demo-ribbon .text { overflow: hidden; text-overflow: ellipsis; }
    #tetra-demo-ribbon .hint { color: #f8b62c; }
    #tetra-demo-ribbon a { color: #9ad8ff; text-decoration: none; flex: none; }
    #tetra-demo-ribbon a:hover { text-decoration: underline; }
    #tetra-demo-ribbon button { all: unset; cursor: pointer; color: #bbb; padding: 0 2px; flex: none; }
    #tetra-demo-ribbon.min .text, #tetra-demo-ribbon.min a { display: none; }
    @media (max-width: 600px) { #tetra-demo-ribbon { font-size: 11px; bottom: 4px; } }
  `;
  document.head.appendChild(style);
  const el = document.createElement('div');
  el.id = 'tetra-demo-ribbon';
  el.setAttribute('role', 'note');
  el.innerHTML = `<span class="dot"></span><span class="text">${TEXT}<span class="hint"></span></span><a href="../">소개 페이지</a><button type="button" title="접기" aria-label="데모 안내 접기">✕</button>`;
  const hint = el.querySelector('.hint') as HTMLElement;
  const update = () => (hint.textContent = location.hash.startsWith('#/login') ? ' · 아무 아이디·비밀번호로 로그인하세요' : '');
  window.addEventListener('hashchange', update);
  update();
  el.querySelector('button')!.addEventListener('click', () => el.classList.toggle('min'));
  const attach = () => document.body.appendChild(el);
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach);
}
