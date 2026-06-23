// Recursive-backtracker maze on a grid. Used (in different guises) for the
// forest's tangled clearings, the mansion's looping halls, and the basement's
// impossible passages. Returns a grid where each cell knows which of its four
// walls are open, plus helpers to walk it.

export function generateMaze(cols, rows, seed = 1, braid = 0) {
  let s = seed >>> 0;
  const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };

  // walls[x][y] = {N,E,S,W} true means OPEN
  const cells = [];
  for (let x = 0; x < cols; x++) {
    cells[x] = [];
    for (let y = 0; y < rows; y++) cells[x][y] = { N: false, E: false, S: false, W: false, visited: false };
  }
  const stack = [[0, 0]];
  cells[0][0].visited = true;
  const dirs = [['N', 0, -1, 'S'], ['S', 0, 1, 'N'], ['E', 1, 0, 'W'], ['W', -1, 0, 'E']];

  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const options = [];
    for (const [d, dx, dy, opp] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !cells[nx][ny].visited) options.push([d, nx, ny, opp]);
    }
    if (options.length) {
      const [d, nx, ny, opp] = options[(rand() * options.length) | 0];
      cells[cx][cy][d] = true; cells[nx][ny][opp] = true;
      cells[nx][ny].visited = true; stack.push([nx, ny]);
    } else stack.pop();
  }

  // braid: knock out some dead-ends to create loops (more confusing, fewer traps)
  if (braid > 0) {
    for (let x = 0; x < cols; x++) for (let y = 0; y < rows; y++) {
      const c = cells[x][y];
      const open = (c.N ? 1 : 0) + (c.E ? 1 : 0) + (c.S ? 1 : 0) + (c.W ? 1 : 0);
      if (open === 1 && rand() < braid) {
        const choices = [];
        for (const [d, dx, dy, opp] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && !c[d]) choices.push([d, nx, ny, opp]);
        }
        if (choices.length) {
          const [d, nx, ny, opp] = choices[(rand() * choices.length) | 0];
          c[d] = true; cells[nx][ny][opp] = true;
        }
      }
    }
  }

  return { cols, rows, cells, rand };
}

// breadth-first distances from a cell, honoring open walls — used to place keys
// far from the entrance and find dead-ends.
export function bfs(maze, sx, sy) {
  const { cols, rows, cells } = maze;
  const dist = [];
  for (let x = 0; x < cols; x++) { dist[x] = new Array(rows).fill(-1); }
  dist[sx][sy] = 0;
  const q = [[sx, sy]];
  const nbr = [['N', 0, -1], ['S', 0, 1], ['E', 1, 0], ['W', -1, 0]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [d, dx, dy] of nbr) {
      if (cells[x][y][d]) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && nx < cols && ny >= 0 && ny < rows && dist[nx][ny] < 0) {
          dist[nx][ny] = dist[x][y] + 1; q.push([nx, ny]);
        }
      }
    }
  }
  return dist;
}

export function farthestCell(maze, sx, sy) {
  const dist = bfs(maze, sx, sy);
  let best = [sx, sy], bd = 0;
  for (let x = 0; x < maze.cols; x++) for (let y = 0; y < maze.rows; y++) {
    if (dist[x][y] > bd) { bd = dist[x][y]; best = [x, y]; }
  }
  return { cell: best, dist: bd, field: dist };
}

export function deadEnds(maze) {
  const out = [];
  for (let x = 0; x < maze.cols; x++) for (let y = 0; y < maze.rows; y++) {
    const c = maze.cells[x][y];
    const open = (c.N ? 1 : 0) + (c.E ? 1 : 0) + (c.S ? 1 : 0) + (c.W ? 1 : 0);
    if (open === 1) out.push([x, y]);
  }
  return out;
}
