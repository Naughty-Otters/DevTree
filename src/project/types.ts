export interface TreeEntry {
  name: string;
  path: string;
  kind: "file" | "directory";
  children?: TreeEntry[];
  /** Directory has children not yet loaded (shallow scan / lazy expand). */
  has_children?: boolean;
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
