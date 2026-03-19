export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { getEnabledAccounts } from '@/lib/config.node';
import { listDriveChildren, type GraphDriveItem } from '@/lib/graph';

interface TreeNode {
  name: string;
  path: string;
  isFolder: boolean;
  childCount?: number;
  children?: TreeNode[];
}

async function buildTree(
  account: Parameters<typeof listDriveChildren>[0],
  folderPath: string,
  depth: number,
  maxDepth: number,
): Promise<TreeNode[]> {
  const items = await listDriveChildren(account, folderPath);
  const nodes: TreeNode[] = [];

  for (const item of items) {
    const itemPath = folderPath ? `${folderPath}/${item.name}` : item.name;
    const node: TreeNode = {
      name: item.name,
      path: itemPath,
      isFolder: !!item.folder,
      childCount: item.folder?.childCount,
    };

    if (item.folder && depth < maxDepth) {
      node.children = await buildTree(account, itemPath, depth + 1, maxDepth);
    }

    nodes.push(node);
  }

  return nodes;
}

export async function GET(request: NextRequest) {
  const depth = Math.min(Number(request.nextUrl.searchParams.get('depth') ?? '2'), 4);
  const folder = request.nextUrl.searchParams.get('folder') ?? '';

  const accounts = getEnabledAccounts('microsoft').filter(a =>
    a.scopes.some(s => s.toLowerCase().startsWith('files.read'))
  );

  if (accounts.length === 0) {
    return NextResponse.json({ error: 'No accounts with Files.Read scope' }, { status: 400 });
  }

  try {
    const tree = await buildTree(accounts[0], folder, 0, depth);
    return NextResponse.json({ root: folder || '/', depth, tree });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
