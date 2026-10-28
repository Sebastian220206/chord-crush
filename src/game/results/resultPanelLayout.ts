/**
 * Where every part of the end-of-level panel sits, for any screen size.
 *
 * The panel is built once and re-labelled, so its geometry is computed rather
 * than baked in: the canvas boots at whatever size the window is, and a phone can
 * be rotated afterwards. A layout that was only correct for the boot size is how
 * a result panel ends up half off a 320px screen.
 *
 * Two rules keep it honest:
 *
 * - Text is sized to fit before it is drawn. Widths are estimated from a
 *   deliberately pessimistic per-character ratio, so the panel errs towards
 *   smaller type rather than overflowing the panel edge.
 * - The stack shrinks to fit the shorter of width and height. On a landscape
 *   phone there is very little height, so the whole stack (fonts, gaps, buttons)
 *   scales down together instead of the buttons sliding off the bottom.
 *
 * Pure geometry: no Phaser, no DOM, so every claim above is testable.
 */

export type TextWeight = 'regular' | 'bold';

export interface ResultPanelSlot {
  /** Vertical centre of the text, in canvas coordinates. */
  y: number;
  fontSize: number;
}

export interface ResultButtonSlot {
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

export interface ResultPanelLayout {
  centerX: number;
  panelWidth: number;
  panelHeight: number;
  /** Top-left corner of the panel, so it can be drawn from the corner out. */
  panelX: number;
  panelY: number;
  heading: ResultPanelSlot;
  levelLine: ResultPanelSlot;
  scoreLabel: ResultPanelSlot;
  scoreValue: ResultPanelSlot;
  /** Null when there is no best line to show, so no empty gap is left behind. */
  bestLine: ResultPanelSlot | null;
  objectivesLabel: ResultPanelSlot;
  objectiveRows: ResultPanelSlot[];
  primary: ResultButtonSlot;
  secondary: ResultButtonSlot;
}

export interface ResultPanelInput {
  width: number;
  height: number;
  heading: string;
  levelLine: string;
  scoreLabel: string;
  scoreValue: string;
  bestLine: string | null;
  objectivesLabel: string;
  objectiveLines: string[];
  primaryLabel: string;
  secondaryLabel: string;
}

/**
 * Average glyph width as a fraction of the font size.
 *
 * Pessimistic on purpose: Arial's uppercase averages about 0.68em and lowercase
 * about 0.52em, so these ratios over-estimate a real string and the fitted font
 * comes out slightly small rather than slightly too wide.
 */
const WEIGHT_RATIO: Record<TextWeight, number> = {
  regular: 0.62,
  bold: 0.72,
};

/** Below this a label stops being readable, so it is the floor for every fit. */
const MIN_FONT = 11;
/** Phaser text is slightly taller than its font size; this is the line box. */
const LINE_HEIGHT = 1.28;
const EDGE_MARGIN = 10;
const PANEL_PADDING = 22;
const PANEL_MAX_WIDTH = 460;
const PANEL_MIN_WIDTH = 140;
/** The stack may shrink to this much of its natural size on a short screen. */
const MIN_SCALE = 0.6;
const BUTTON_MIN_HEIGHT = 40;

const BASE = {
  heading: 34,
  levelLine: 16,
  scoreLabel: 12,
  scoreValue: 44,
  bestLine: 15,
  objectivesLabel: 12,
  objectiveRow: 17,
  primaryLabel: 21,
  secondaryLabel: 18,
  buttonWidth: 280,
  buttonHeight: 54,
};

const GAP = {
  heading: 10,
  levelLine: 16,
  scoreLabel: 4,
  scoreValue: 12,
  bestLine: 16,
  objectivesLabel: 8,
  betweenRows: 5,
  primary: 22,
  betweenButtons: 12,
};

/**
 * How wide a string is likely to be, in pixels.
 *
 * An estimate rather than a measurement because the layout has to be decided
 * before the Phaser text objects exist, and because text width has to be a pure
 * function to be worth testing.
 */
export function estimateTextWidth(
  text: string,
  fontSize: number,
  weight: TextWeight = 'regular'
): number {
  return text.length * fontSize * WEIGHT_RATIO[weight];
}

/** The largest font size that keeps this string inside maxWidth, capped at max. */
export function fitFontSize(
  text: string,
  maxWidth: number,
  weight: TextWeight,
  max: number
): number {
  // Nothing to fit: the floor is the only sensible answer.
  if (text.length === 0 || maxWidth <= 0) return MIN_FONT;

  const ceiling = Math.max(MIN_FONT, max);
  const fitted = Math.floor(maxWidth / (text.length * WEIGHT_RATIO[weight]));

  return Math.max(MIN_FONT, Math.min(ceiling, fitted));
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low;
  if (high < low) return low;

  return Math.min(high, Math.max(low, value));
}

/**
 * One row of the vertical stack.
 *
 * The font size travels with the row, so nothing later has to work out which row
 * a size belonged to by matching heights or positions.
 */
interface StackRow {
  height: number;
  /** Vertical gap above this row. */
  gapBefore: number;
  /** 0 for the two buttons, which carry their own label sizes. */
  fontSize: number;
  isButton: boolean;
}

function textHeight(fontSize: number): number {
  return Math.ceil(fontSize * LINE_HEIGHT);
}

function textRow(fontSize: number, gapBefore: number): StackRow {
  return { height: textHeight(fontSize), gapBefore, fontSize, isButton: false };
}

function buttonRow(gapBefore: number): StackRow {
  return { height: BASE.buttonHeight, gapBefore, fontSize: 0, isButton: true };
}

/** Scaled to the screen, floored so nothing becomes unreadable. */
function scaleFont(fontSize: number, scale: number): number {
  return Math.max(MIN_FONT, Math.round(fontSize * scale));
}

function stackHeight(rows: StackRow[], gapScale: number): number {
  let total = 0;

  for (const row of rows) {
    total += row.height + row.gapBefore * gapScale;
  }

  return total;
}

/**
 * The whole panel's geometry for one canvas size.
 *
 * Deterministic: the same size and the same strings always produce the same
 * layout, which is what makes it safe to recompute on every resize.
 */
export function computeResultPanelLayout(input: ResultPanelInput): ResultPanelLayout {
  const width = Math.max(1, Math.floor(input.width));
  const height = Math.max(1, Math.floor(input.height));
  const centerX = Math.round(width / 2);
  const available = Math.max(1, height - EDGE_MARGIN * 2);
  const budget = Math.max(1, available - PANEL_PADDING * 2);

  const panelWidth = Math.max(
    PANEL_MIN_WIDTH,
    Math.min(PANEL_MAX_WIDTH, width - EDGE_MARGIN * 2)
  );
  const innerWidth = Math.max(40, panelWidth - PANEL_PADDING * 2);
  const buttonWidth = Math.max(120, Math.min(BASE.buttonWidth, innerWidth));
  // A label sits well inside its button, so the fit uses the button's own width.
  const buttonLabelWidth = Math.max(60, buttonWidth - 30);

  // Width first: no string may be wider than the space it is drawn into.
  const headingFont = fitFontSize(input.heading, innerWidth, 'bold', BASE.heading);
  const levelFont = fitFontSize(input.levelLine, innerWidth, 'regular', BASE.levelLine);
  const scoreLabelFont = fitFontSize(input.scoreLabel, innerWidth, 'regular', BASE.scoreLabel);
  const scoreFont = fitFontSize(input.scoreValue, innerWidth, 'bold', BASE.scoreValue);
  const objectivesLabelFont = fitFontSize(
    input.objectivesLabel,
    innerWidth,
    'regular',
    BASE.objectivesLabel
  );
  const bestFont =
    input.bestLine === null
      ? BASE.bestLine
      : fitFontSize(input.bestLine, innerWidth, 'bold', BASE.bestLine);
  const primaryFont = fitFontSize(input.primaryLabel, buttonLabelWidth, 'bold', BASE.primaryLabel);
  const secondaryFont = fitFontSize(
    input.secondaryLabel,
    buttonLabelWidth,
    'bold',
    BASE.secondaryLabel
  );

  // One row size for the whole objective list, so it reads as a list.
  let rowFont = BASE.objectiveRow;
  for (const line of input.objectiveLines) {
    rowFont = Math.min(rowFont, fitFontSize(line, innerWidth, 'regular', BASE.objectiveRow));
  }

  const naturalRows: StackRow[] = [
    textRow(headingFont, 0),
    textRow(levelFont, GAP.heading),
    textRow(scoreLabelFont, GAP.levelLine),
    textRow(scoreFont, GAP.scoreLabel),
  ];

  if (input.bestLine !== null) naturalRows.push(textRow(bestFont, GAP.scoreValue));

  naturalRows.push(textRow(objectivesLabelFont, GAP.bestLine));

  input.objectiveLines.forEach((line, index) => {
    naturalRows.push(textRow(rowFont, index === 0 ? GAP.objectivesLabel : GAP.betweenRows));
  });

  naturalRows.push(buttonRow(GAP.primary));
  naturalRows.push(buttonRow(GAP.betweenButtons));

  // Height second: the whole stack scales down together when the screen is short.
  const scale = clamp(budget / stackHeight(naturalRows, 1), MIN_SCALE, 1);

  const rows: StackRow[] = naturalRows.map((row) =>
    row.isButton
      ? // Buttons keep a floor so the actions stay tappable on a short screen.
        { ...row, height: Math.max(BUTTON_MIN_HEIGHT, Math.round(BASE.buttonHeight * scale)) }
      : { ...row, fontSize: scaleFont(row.fontSize, scale), height: textHeight(scaleFont(row.fontSize, scale)) }
  );

  // The button floor can push the stack past the budget again; the gaps give the
  // difference back, and they can go all the way to zero before anything is cut.
  let gapScale = scale;
  const gapTotal = rows.reduce((sum, row) => sum + row.gapBefore, 0);

  if (stackHeight(rows, gapScale) > budget && gapTotal > 0) {
    const overflow = stackHeight(rows, gapScale) - budget;
    gapScale = Math.max(0, (gapTotal * gapScale - overflow) / gapTotal);
  }

  const total = stackHeight(rows, gapScale);
  const top = clamp(
    (height - total) / 2,
    EDGE_MARGIN,
    Math.max(EDGE_MARGIN, height - EDGE_MARGIN - total)
  );

  const panelY = Math.round(Math.max(0, top - PANEL_PADDING));
  const panelBottom = Math.round(Math.min(height, top + total + PANEL_PADDING));
  const panelHeight = Math.max(1, panelBottom - panelY);
  const panelX = Math.round(Math.max(0, (width - panelWidth) / 2));

  // Walk the stack once, turning each row into the centre line its text wants.
  let cursor = top;
  const takeTextRow = (): ResultPanelSlot => {
    const row = rows.shift();

    if (row) cursor += row.gapBefore * gapScale;

    const slot = {
      y: Math.round(cursor + (row ? row.height : 0) / 2),
      fontSize: row ? row.fontSize : MIN_FONT,
    };
    cursor += row ? row.height : 0;

    return slot;
  };

  const heading = takeTextRow();
  const levelLine = takeTextRow();
  const scoreLabel = takeTextRow();
  const scoreValue = takeTextRow();
  const bestLine = input.bestLine === null ? null : takeTextRow();
  const objectivesLabel = takeTextRow();
  const objectiveRows: ResultPanelSlot[] = input.objectiveLines.map(() => takeTextRow());

  const takeButton = (fontSize: number): ResultButtonSlot => {
    const row = rows.shift();

    cursor += (row ? row.gapBefore * gapScale : 0);

    const buttonHeight = row ? row.height : BUTTON_MIN_HEIGHT;
    const button = {
      y: Math.round(cursor + buttonHeight / 2),
      width: buttonWidth,
      height: buttonHeight,
      fontSize: scaleFont(fontSize, scale),
    };
    cursor += buttonHeight;

    return button;
  };

  const primary = takeButton(primaryFont);
  const secondary = takeButton(secondaryFont);

  return {
    centerX,
    panelWidth,
    panelHeight,
    panelX,
    panelY,
    heading,
    levelLine,
    scoreLabel,
    scoreValue,
    bestLine,
    objectivesLabel,
    objectiveRows,
    primary,
    secondary,
  };
}
