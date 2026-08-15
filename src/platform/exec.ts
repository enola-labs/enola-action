import * as exec from "@actions/exec";

export interface Result {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function capture(
  command: string,
  args: string[],
  cwd: string,
  ignoreReturnCode = false,
): Promise<Result> {
  let stdout = "";
  let stderr = "";
  const exitCode = await exec.exec(command, args, {
    cwd,
    ignoreReturnCode,
    silent: true,
    listeners: {
      stdout: (data) => (stdout += data.toString()),
      stderr: (data) => (stderr += data.toString()),
    },
  });
  return { exitCode, stdout, stderr };
}
