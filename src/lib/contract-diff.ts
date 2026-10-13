export type ContractDiffKind = 'unchanged' | 'added' | 'removed';

export interface ContractDiffBlock {
  kind: ContractDiffKind;
  lines: string[];
}

export function diffContractText(before: string, after: string): ContractDiffBlock[] {
  const oldLines = before.split(/\r?\n/);
  const newLines = after.split(/\r?\n/);
  const columns = newLines.length + 1;
  const cellCount = (oldLines.length + 1) * columns;
  if (cellCount > 1_000_000) {
    return compactDiff([
      { kind: 'removed', line: before },
      { kind: 'added', line: after },
    ]);
  }

  const table = new Uint32Array(cellCount);
  for (let oldIndex = oldLines.length - 1; oldIndex >= 0; oldIndex -= 1) {
    for (let newIndex = newLines.length - 1; newIndex >= 0; newIndex -= 1) {
      const index = oldIndex * columns + newIndex;
      table[index] = oldLines[oldIndex] === newLines[newIndex]
        ? table[(oldIndex + 1) * columns + newIndex + 1] + 1
        : Math.max(
            table[(oldIndex + 1) * columns + newIndex],
            table[oldIndex * columns + newIndex + 1]
          );
    }
  }

  const edits: Array<{ kind: ContractDiffKind; line: string }> = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldLines.length && newIndex < newLines.length) {
    if (oldLines[oldIndex] === newLines[newIndex]) {
      edits.push({ kind: 'unchanged', line: oldLines[oldIndex] });
      oldIndex += 1;
      newIndex += 1;
    } else if (
      table[(oldIndex + 1) * columns + newIndex]
      >= table[oldIndex * columns + newIndex + 1]
    ) {
      edits.push({ kind: 'removed', line: oldLines[oldIndex] });
      oldIndex += 1;
    } else {
      edits.push({ kind: 'added', line: newLines[newIndex] });
      newIndex += 1;
    }
  }
  while (oldIndex < oldLines.length) {
    edits.push({ kind: 'removed', line: oldLines[oldIndex++] });
  }
  while (newIndex < newLines.length) {
    edits.push({ kind: 'added', line: newLines[newIndex++] });
  }
  return compactDiff(edits);
}

function compactDiff(
  edits: Array<{ kind: ContractDiffKind; line: string }>
): ContractDiffBlock[] {
  const blocks: ContractDiffBlock[] = [];
  for (const edit of edits) {
    const current = blocks[blocks.length - 1];
    if (current?.kind === edit.kind) {
      current.lines.push(edit.line);
    } else {
      blocks.push({ kind: edit.kind, lines: [edit.line] });
    }
  }
  return blocks;
}
