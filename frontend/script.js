// В вашем script.js добавьте или обновите этот код
const joinBtn = document.getElementById('joinBtn');
joinBtn?.addEventListener('click', (e) => {
    const href = joinBtn.getAttribute('href');
    if (!href || !href.startsWith('#')) return;
    
    const targetId = href.substring(1);
    const target = document.getElementById(targetId);
    if (!target) return;

    e.preventDefault();
    
    // Плавная прокрутка к форме
    target.scrollIntoView({
        behavior: 'smooth',
        block: 'start' // Выровнять по верху
    });
    
    // ИЛИ альтернативный вариант с расчетом позиции:
    // const y = target.getBoundingClientRect().top + window.pageYOffset - 20;
    // window.scrollTo({
    //     top: y,
    //     behavior: 'smooth'
    // });
}, { passive: false });


const parallax = document.getElementById('parallax');
let px = 0, py = 0;
let tx = 0, ty = 0;

function tick() {
  px += (tx - px) * 0.06;
  py += (ty - py) * 0.06;
  parallax.style.transform = `translate3d(${px}px, ${py}px, 0)`;
  requestAnimationFrame(tick);
}
tick();

window.addEventListener('mousemove', (e) => {
  const { innerWidth: w, innerHeight: h } = window;
  const dx = (e.clientX / w - 0.5) * 16;
  const dy = (e.clientY / h - 0.5) * 10;
  tx = dx;
  ty = dy;
}, { passive: true });

const tiles = document.querySelectorAll('.tile');
tiles.forEach((tile) => {
  let holdTimer = null;

  const onEnter = () => {
    tile.classList.add('hovering');
    tile.style.willChange = 'transform, filter, opacity';
  };

  const onLeave = () => {
    tile.classList.remove('hovering');
    tile.classList.add('hold');
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      tile.classList.remove('hold');
      tile.style.willChange = 'auto';
    }, 250);
  };

  tile.addEventListener('mouseenter', onEnter, { passive: true });
  tile.addEventListener('mouseleave', onLeave, { passive: true });
  tile.addEventListener('focusin', onEnter);
  tile.addEventListener('focusout', onLeave);
});