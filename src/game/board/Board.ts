import { Tile } from './Tile';

export interface Grid {
  rows: number;
  columns: number;
}

export class Board {
  private readonly grid: (Tile | null)[][];
  private readonly gridSize: Grid;
  private selectedTile: Tile | null = null;
  private draggingTile: Tile | null = null;

  constructor(rows: number = 8, columns: number = 8) {
    this.gridSize = { rows, columns };
    this.grid = [];
    this.initializeGrid();
  }

  /**
   * Builds a board from a grid of notes, one string array per row.
   *
   * The layout describes note values, not tile identity, so this is the entry
   * point for generators, shuffles and tests that need an exact starting
   * position. Notes must be single characters, because they are assigned to
   * tiles one cell at a time.
   */
  public static fromLayout(layout: readonly (readonly string[])[]): Board {
    const rows = layout.length;
    const columns = layout[0]?.length ?? 0;
    const board = new Board(rows, columns);

    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const tile = board.getTileAt(row, column);
        if (tile) (tile as { noteType: string }).noteType = layout[row][column];
      }
    }

    return board;
  }

  private initializeGrid(): void {
    for (let row = 0; row < this.gridSize.rows; row++) {
      const newRow: (Tile | null)[] = [];
      for (let column = 0; column < this.gridSize.columns; column++) {
        newRow.push(new Tile(row, column));
      }
      this.grid.push(newRow);
    }
  }

  public getSize(): Grid {
    return { rows: this.gridSize.rows, columns: this.gridSize.columns };
  }

  public getTileAt(row: number, column: number): Tile | null {
    if (row < 0 || row >= this.gridSize.rows || column < 0 || column >= this.gridSize.columns) {
      return null;
    }
    return this.grid[row][column];
  }

  public isEmpty(row: number, column: number): boolean {
    return this.getTileAt(row, column) === null;
  }

  /**
   * Moves a tile into a different cell, keeping the same Tile object so its id,
   * note and any Phaser visual bound to it all stay valid.
   *
   * The tile does not have to be on the board already: refill passes a freshly
   * created tile here to seat it in an empty cell. The target cell must be
   * empty, so this can never silently overwrite a live tile.
   *
   * @returns true if the tile now occupies the requested cell
   */
  public moveTile(tile: Tile, row: number, column: number): boolean {
    if (row < 0 || row >= this.gridSize.rows || column < 0 || column >= this.gridSize.columns) {
      return false;
    }

    if (this.grid[row][column] !== null) return false;

    // Clear the cell the tile is leaving, if it still owns it.
    const previousRow = tile.row;
    const previousColumn = tile.column;
    const previousInBounds =
      previousRow >= 0 &&
      previousRow < this.gridSize.rows &&
      previousColumn >= 0 &&
      previousColumn < this.gridSize.columns;

    if (previousInBounds && this.grid[previousRow][previousColumn] === tile) {
      this.grid[previousRow][previousColumn] = null;
    }

    this.grid[row][column] = tile;
    tile.row = row;
    tile.column = column;

    return true;
  }

  /**
   * Empties the cell a tile occupies. Matched tiles are removed this way and
   * the cell stays empty until gravity and refill fill it again.
   *
   * The cell must still hold this exact tile instance, so a stale reference
   * can never blank out an unrelated cell. Returns false when the tile is out
   * of bounds, no longer on the board, or its cell is already empty.
   */
  public removeTile(tile: Tile): boolean {
    if (tile.row < 0 || tile.row >= this.gridSize.rows) return false;
    if (tile.column < 0 || tile.column >= this.gridSize.columns) return false;

    if (this.grid[tile.row][tile.column] !== tile) return false;

    this.grid[tile.row][tile.column] = null;

    // Never leave a stale reference to a tile that no longer exists.
    if (this.selectedTile === tile) this.selectedTile = null;
    if (this.draggingTile === tile) this.draggingTile = null;

    return true;
  }

  public selectTile(row: number, column: number): boolean {
    const tile = this.getTileAt(row, column);
    if (!tile) return false;
    
    // Deselect any previously selected tile
    if (this.selectedTile !== null) {
      this.deselectTile();
    }
    
    this.selectedTile = tile;
    return true;
  }

  public deselectTile(): void {
    this.selectedTile = null;
  }

  public isAdjacent(tile1: Tile, tile2: Tile): boolean {
    const rowDiff = Math.abs(tile1.row - tile2.row);
    const colDiff = Math.abs(tile1.column - tile2.column);
    
    // Two tiles are adjacent if they differ by exactly one unit in either row or column
    return (rowDiff === 1 && colDiff === 0) || (colDiff === 1 && rowDiff === 0);
  }

  public swapAdjacentTiles(tile1: Tile, tile2: Tile): boolean {
    if (!this.selectedTile || !tile2) return false;
    
    // Check if tiles are adjacent and not the same
    if (!this.isAdjacent(this.selectedTile, tile2)) {
      return false;
    }
    
    // Ensure we're swapping with a valid non-selected target
    if (this.selectedTile === tile2) {
      return false;
    }
    
    // Store the original values
    const temp1 = this.selectedTile.noteType;
    const temp2 = tile2.noteType;
    
    // Swap the note types
    this.selectedTile.noteType = temp2;
    tile2.noteType = temp1;
    
    return true;
  }

  public render(ctx: CanvasRenderingContext2D, offsetX: number, offsetY: number): void {
    const tileSize = 64; // Size of each tile in pixels
    const boardWidth = this.gridSize.columns * tileSize;
    const boardHeight = this.gridSize.rows * tileSize;
    
    ctx.save();
    ctx.translate(offsetX, offsetY);
    
    // Draw the background
    ctx.fillStyle = '#f0f0f0';
    ctx.fillRect(0, 0, boardWidth, boardHeight);
    
    // Draw each tile
    for (let row = 0; row < this.gridSize.rows; row++) {
      for (let column = 0; column < this.gridSize.columns; column++) {
        const tile = this.getTileAt(row, column);
        if (!tile) continue;
        
        // Calculate tile position and size
        const x = column * tileSize;
        const y = row * tileSize;
        
        // Draw the note letter in the center of each tile
        ctx.fillStyle = 'black';
        ctx.font = `32px Arial`;
        ctx.textAlign = 'center';
        ctx.fillText(tile.noteType, x + tileSize / 2, y + tileSize / 2);
      }
    }
    
    // Highlight the selected tile
    if (this.selectedTile) {
      const x = this.selectedTile.column * tileSize;
      const y = this.selectedTile.row * tileSize;
      ctx.strokeStyle = 'blue';
      ctx.lineWidth = 3;
      ctx.strokeRect(x, y, tileSize, tileSize);
    }
    
    ctx.restore();
  }
}