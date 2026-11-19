// Общие UI-помощники: текст и диалоговое окно.
// Основной шрифт — Alegreya Sans (чёткая кириллица), заголовки и цифры — Press Start 2P (пиксельный)
export const FONT = '"Alegreya Sans", Verdana, sans-serif';
export const PIXEL_FONT = '"Press Start 2P", monospace';

export function txt(scene, x, y, str, size = 8, color = '#e8dccc', opts = {}) {
  const t = scene.add.text(x, y, str, {
    fontFamily: opts.pixel ? PIXEL_FONT : FONT,
    // пиксельный шрифт широкий — уменьшаем; обычный — не мельче 9 px, иначе плохо читается
    fontSize: opts.pixel ? `${Math.max(5, Math.round(size * 0.6))}px` : `${Math.max(size + 2, 9)}px`,
    color,
    fontStyle: opts.bold && !opts.pixel ? 'bold' : 'normal',
    align: opts.align || 'left',
    wordWrap: opts.wrap ? { width: opts.wrap } : undefined,
    stroke: opts.stroke || '#07040c',
    strokeThickness: opts.strokeThickness ?? 2,
    resolution: 4, // текст рисуется в 4 раза чётче, чем пиксель-арт
  });
  if (opts.origin !== undefined) t.setOrigin(...[].concat(opts.origin));
  return t;
}

// Диалоговое окно внизу экрана. lines — массив строк, onDone — по окончании.
export class Dialogue {
  constructor(scene) {
    this.scene = scene;
    const W = scene.scale.width, H = scene.scale.height;
    this.box = scene.add.rectangle(W / 2, H - 34, W - 20, 56, 0x0d0814, 0.92)
      .setStrokeStyle(1, 0x6ff0e0, 0.6).setScrollFactor(0).setDepth(1000).setVisible(false);
    this.name = txt(scene, 18, H - 60, '', 8, '#6ff0e0', { bold: true }).setScrollFactor(0).setDepth(1001);
    this.body = txt(scene, 18, H - 49, '', 8, '#e8dccc', { wrap: W - 40 }).setScrollFactor(0).setDepth(1001);
    this.hint = txt(scene, W - 16, H - 14, '[Пробел]', 6, '#8a8090', { origin: [1, 0.5] }).setScrollFactor(0).setDepth(1001);
    this.active = false;
    this.hide();
  }

  show(name, lines, onDone) {
    this.lines = lines; this.i = 0; this.onDone = onDone; this.active = true;
    this.box.setVisible(true); this.name.setVisible(true).setText(name);
    this.body.setVisible(true); this.hint.setVisible(true);
    this.typeLine();
  }

  typeLine() {
    const full = this.lines[this.i];
    this.typing = true; this.shown = 0;
    this.timer?.remove();
    this.timer = this.scene.time.addEvent({
      delay: 22, repeat: full.length - 1,
      callback: () => {
        this.shown++;
        this.body.setText(full.slice(0, this.shown));
        if (this.shown >= full.length) this.typing = false;
      },
    });
  }

  // Вызывать по нажатию «продолжить»
  next() {
    if (!this.active) return;
    if (this.typing) { // первое нажатие дописывает строку сразу
      this.timer.remove(); this.typing = false; this.body.setText(this.lines[this.i]); return;
    }
    this.i++;
    if (this.i >= this.lines.length) { this.hide(); this.onDone?.(); }
    else this.typeLine();
  }

  hide() {
    this.active = false;
    [this.box, this.name, this.body, this.hint].forEach((o) => o.setVisible(false));
  }
}
