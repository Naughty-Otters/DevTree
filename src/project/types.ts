export interface TreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: TreeEntry[];
}

export interface ModuleEntry {
  name: string;
  path: string;
  kind: "file" | "folder";
  file_count: number;
}

export interface ProjectScan {
  root: string;
  tree: TreeEntry;
  modules: ModuleEntry[];
}
