import { hasValidBounds, mergeBounds } from "../domain/math.js";

const DEFAULT_MIN_CELLS = 8;
const DEFAULT_MAX_CELLS = 256;
const DEFAULT_MAX_CELLS_PER_ITEM = 32;

export class SpatialIndex {
  constructor(bounds, options = {}) {
    this.bounds = hasValidBounds(bounds) ? bounds : { minX: -10, minY: -10, maxX: 10, maxY: 10 };
    this.items = [];
    this.itemBounds = [];
    this.cells = new Map();
    this.largeIndexes = [];
    this.alwaysIndexes = [];
    this.maxCellsPerItem = options.maxCellsPerItem ?? DEFAULT_MAX_CELLS_PER_ITEM;

    const width = Math.max(1e-9, this.bounds.maxX - this.bounds.minX);
    const height = Math.max(1e-9, this.bounds.maxY - this.bounds.minY);
    const requestedColumns = options.columns ?? DEFAULT_MIN_CELLS;
    const requestedRows = options.rows ?? DEFAULT_MIN_CELLS;
    this.columns = clampInt(requestedColumns, 1, DEFAULT_MAX_CELLS);
    this.rows = clampInt(requestedRows, 1, DEFAULT_MAX_CELLS);
    this.cellWidth = width / this.columns;
    this.cellHeight = height / this.rows;
  }

  static fromItems(items, boundsForItem, worldBounds = null, options = {}) {
    const validBounds = [];
    for (const item of items) {
      const bounds = boundsForItem(item);
      if (hasValidBounds(bounds)) validBounds.push(bounds);
    }
    const bounds = hasValidBounds(worldBounds) ? worldBounds : mergeBounds(validBounds);
    const cellShape = chooseCellShape(bounds, Math.max(1, validBounds.length), options);
    const index = new SpatialIndex(bounds, { ...options, ...cellShape });
    for (const item of items) index.insert(item, boundsForItem(item));
    return index;
  }

  insert(item, bounds) {
    const itemIndex = this.items.length;
    this.items.push(item);
    this.itemBounds.push(bounds);
    if (!hasValidBounds(bounds)) {
      this.alwaysIndexes.push(itemIndex);
      return;
    }

    const range = this.cellRange(bounds);
    const cellCount = (range.maxColumn - range.minColumn + 1) * (range.maxRow - range.minRow + 1);
    if (cellCount > this.maxCellsPerItem) {
      this.largeIndexes.push(itemIndex);
      return;
    }

    for (let row = range.minRow; row <= range.maxRow; row += 1) {
      for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
        const key = `${column}:${row}`;
        let cell = this.cells.get(key);
        if (!cell) {
          cell = [];
          this.cells.set(key, cell);
        }
        cell.push(itemIndex);
      }
    }
  }

  query(bounds) {
    if (!hasValidBounds(bounds)) return [...this.items];
    const out = [];
    const seen = new Set();
    const add = (itemIndex) => {
      if (seen.has(itemIndex)) return;
      const itemBounds = this.itemBounds[itemIndex];
      if (hasValidBounds(itemBounds) && !boundsIntersects(itemBounds, bounds)) return;
      seen.add(itemIndex);
      out.push(this.items[itemIndex]);
    };

    for (const itemIndex of this.alwaysIndexes) add(itemIndex);
    for (const itemIndex of this.largeIndexes) add(itemIndex);

    const range = this.cellRange(bounds);
    for (let row = range.minRow; row <= range.maxRow; row += 1) {
      for (let column = range.minColumn; column <= range.maxColumn; column += 1) {
        const cell = this.cells.get(`${column}:${row}`);
        if (!cell) continue;
        for (const itemIndex of cell) add(itemIndex);
      }
    }
    return out;
  }

  cellRange(bounds) {
    const minColumn = Math.floor((bounds.minX - this.bounds.minX) / this.cellWidth);
    const maxColumn = Math.floor((bounds.maxX - this.bounds.minX) / this.cellWidth);
    const minRow = Math.floor((bounds.minY - this.bounds.minY) / this.cellHeight);
    const maxRow = Math.floor((bounds.maxY - this.bounds.minY) / this.cellHeight);
    return {
      minColumn: clampInt(minColumn, 0, this.columns - 1),
      maxColumn: clampInt(maxColumn, 0, this.columns - 1),
      minRow: clampInt(minRow, 0, this.rows - 1),
      maxRow: clampInt(maxRow, 0, this.rows - 1),
    };
  }
}

function chooseCellShape(bounds, itemCount, options) {
  if (options.columns && options.rows) return { columns: options.columns, rows: options.rows };
  const width = Math.max(1e-9, bounds.maxX - bounds.minX);
  const height = Math.max(1e-9, bounds.maxY - bounds.minY);
  const aspect = width / height;
  const targetCells = clampInt(itemCount * 2, DEFAULT_MIN_CELLS * DEFAULT_MIN_CELLS, DEFAULT_MAX_CELLS * 64);
  const columns = clampInt(Math.ceil(Math.sqrt(targetCells * aspect)), DEFAULT_MIN_CELLS, DEFAULT_MAX_CELLS);
  const rows = clampInt(Math.ceil(targetCells / columns), DEFAULT_MIN_CELLS, DEFAULT_MAX_CELLS);
  return { columns, rows };
}

function boundsIntersects(a, b) {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

function clampInt(value, min, max) {
  return Math.max(min, Math.min(max, Math.trunc(Number.isFinite(value) ? value : min)));
}
