import { resolve } from "path";

export function getProjectFilePath(): string {
  return resolve(
    process.env.SMCRAFT_PROJECT_FILE ?? "./statemachine.smdf.json"
  );
}
