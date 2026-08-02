// Migrated from public/shapes/mover.js.
//
// Only change from the original: the p5 constants HSL and CENTER used to be
// read off `window` (global mode). A scene runs in instance mode, so they come
// off the canvas that's passed in. Everything else is untouched.

export class Mover {
	constructor(x, y, size, palette) {
		this.x = x;
		this.y = y;
		this.size = size;
		this.palette = palette;
		this.colorIndex = 0;
		this.currentColor = this.palette[this.colorIndex];
		this.angle = 0;
	}

	show(canvas) {
		const {h, s, l} = this.currentColor;
		canvas.colorMode(canvas.HSL);
		const trackHeight = this.size * 1;
		const squareSize = this.size / 2;
		const maxTravel = trackHeight / 2 - squareSize / 2;
		const squareX = this.x + Math.sin(this.angle) * maxTravel;
		const reverseSquareX = this.x - Math.sin(this.angle) * maxTravel;
		const complementaryHue = (210 + 180) % 360;

		canvas.noStroke();
		canvas.push();
		canvas.rectMode(canvas.CENTER);
		canvas.fill(240, 100, 50);
		canvas.rect(this.x, this.y, trackHeight, this.size * 2);
		canvas.pop();

		canvas.push();
		canvas.rectMode(canvas.CENTER);
		canvas.fill(170, 100, 70, 100);
		canvas.rect(squareX, this.y, squareSize * 1, squareSize * 2);
		canvas.pop();

		canvas.push();
		canvas.rectMode(canvas.CENTER);
		canvas.fill(30, 100, 50, 100);
		canvas.rect(reverseSquareX, this.y, squareSize * 1, squareSize * 2);
		canvas.pop();
	}

	move(frameCount) {
		this.angle += 0.0018;
		this.colorIndex = Math.floor(frameCount * 0.05) % this.palette.length;
		this.currentColor = this.palette[this.colorIndex];
	}
}
