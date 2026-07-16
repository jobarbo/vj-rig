/**
 * Color palettes for generative token
 * Each palette is an array of hex colors that can be selected at initialization
 */

const PALETTES = {
	hex_palette: ["#ffffff"],
};

// Get a palette by name
function getPalette(paletteName) {
	return PALETTES[paletteName] || PALETTES.hex_palette;
}

// Get all available palette names
function getPaletteNames() {
	return Object.keys(PALETTES);
}
