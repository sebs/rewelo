import { DB } from "../db/connection.js";
import { listProjects } from "../projects/repository.js";
import { getWeights } from "../weights/repository.js";
import { exportProjectData } from "../serialization/export-project.js";
import type { TagPair, SerializedTicket } from "../serialization/export-project.js";
import { VERSION } from "../version.generated.js";

export interface BackupProject {
  name: string;
  tickets: SerializedTicket[];
  tags: TagPair[];
  weights: { w1: number; w2: number; w3: number; w4: number } | null;
}

export interface BackupData {
  schemaVersion: 1;
  createdAt: string;
  appVersion: string;
  projects: BackupProject[];
}

export async function backup(db: DB): Promise<BackupData> {
  const projects = await listProjects(db);
  const backupProjects: BackupProject[] = [];

  for (const project of projects) {
    const data = await exportProjectData(db, project.id);
    const weightConfig = await getWeights(db, project.id);

    const hasCustomWeights =
      weightConfig.w1 !== 1.5 ||
      weightConfig.w2 !== 1.5 ||
      weightConfig.w3 !== 1.5 ||
      weightConfig.w4 !== 1.5;

    backupProjects.push({
      name: project.name,
      tickets: data.tickets,
      tags: data.tags,
      weights: hasCustomWeights
        ? { w1: weightConfig.w1, w2: weightConfig.w2, w3: weightConfig.w3, w4: weightConfig.w4 }
        : null,
    });
  }

  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    appVersion: VERSION,
    projects: backupProjects,
  };
}
