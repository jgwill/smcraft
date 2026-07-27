import { resolve } from "path";
import { envAlias } from "@miadi/stateloom-protocol";

export function getProjectFilePath(): string {
  return resolve(envAlias("PROJECT_FILE") ?? "./statemachine.smdf.json");
}
