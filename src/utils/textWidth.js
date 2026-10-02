/**
 * textWidth.js — how wide a string renders, without rendering it.
 *
 * Used by the double-click auto-fit on a column divider: Excel sizes a column to its widest
 * cell, and answering "how wide is the widest cell" needs a measurement of text that is
 * currently inside inputs, spans and truncated cells. Measuring the DOM would mean reading
 * back every cell (a layout thrash per column, and truncated cells report the truncated
 * width, which is the wrong answer). A canvas measures the string itself, at the real font,
 * with no layout involved.
 *
 * The canvas is created once and never attached to the document.
 */

let context = null;

const measuringContext = () => {
    if (context) return context;
    try {
        context = document.createElement('canvas').getContext('2d');
    } catch {
        context = null;
    }
    return context;
};

/**
 * The CSS `font` shorthand of a live element, which is what the canvas needs to match it.
 * Built by hand because getComputedStyle().font comes back empty in some browsers.
 */
export const fontOf = (element) => {
    if (!element) return '400 14px sans-serif';
    const style = window.getComputedStyle(element);
    return `${style.fontStyle} ${style.fontWeight} ${style.fontSize} / ${style.lineHeight} ${style.fontFamily}`;
};

/** Width of `text` in that font, in CSS pixels. 0 when a canvas is not available. */
export const measureText = (text, font) => {
    const ctx = measuringContext();
    if (!ctx) return 0;
    ctx.font = font;
    return ctx.measureText(String(text ?? '')).width;
};

/** Width of the widest of several strings. */
export const widestText = (texts, font) =>
    texts.reduce((widest, text) => Math.max(widest, measureText(text, font)), 0);

/**
 * A wrapping header's real constraint is its longest single WORD, not the whole label:
 * "Days Employee Worked / Workdays" fits a narrow column happily by wrapping, and sizing a
 * column to hold it on one line would make it absurdly wide.
 */
export const widestWord = (label, font) =>
    widestText(String(label ?? '').split(/\s+/).filter(Boolean), font);
