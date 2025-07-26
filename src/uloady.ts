import console from 'node:console';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import util from 'node:util';

const programName = process.argv[1] ? path.basename(process.argv[1]) : 'uloady';
const programVersion: string = JSON.parse(fs.readFileSync(
      import.meta.dirname + '/../package.json',
      'utf8'
)).version;
const userAgent = `uloady/${programVersion}`;

abstract class FileHost {
  protected abstract sendFile(
    fileName: string, data: Promise<Blob>): Promise<string>;

  private sendfile_impl: typeof this.sendFile;

  async upload(fileName: string): Promise<string> {
    return this.sendfile_impl(fileName, fs.openAsBlob(fileName));
  }

  constructor(sendFile?: boolean | typeof this.sendFile) {
    switch (sendFile) {
      case true:
      case undefined:
        this.sendfile_impl = this.sendFile;
        break;
      case false:
        this.sendfile_impl = () => new Promise((resolve) => resolve("dry run"));
        break;
      default:
        this.sendfile_impl = sendFile
        break;
    }
  }
};

export class Catbox extends FileHost {
  protected async sendFile(
    fileName: string,
    dataPromise: Promise<Blob>
  ): Promise<string> {
    const formData = new FormData();
    const data = await dataPromise;
    formData.append('reqtype', 'fileupload');
    formData.append('time', '12h');
    formData.append('fileToUpload', data, fileName);
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'content-length': data.size.toString(),
      },
      body: formData,
    };
    const request = new Request(
      'https://litterbox.catbox.moe/resources/internals/api.php',
      options
    );
    const response = await fetch(request);
    if (!response.ok) {
      throw response;
    }
    return response.text();
  }
};

export class X0at extends FileHost {
  protected async sendFile(
    fileName: string,
    dataPromise: Promise<Blob>
  ): Promise<string> {
    const formData = new FormData();
    formData.append('file', dataPromise);
    formData.append('filename', fileName);
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'content-length': (await dataPromise).size.toString(),
        'user-agent': userAgent,
      },
      body: formData,
    };
    const request = new Request(
      'https://x0.at',
      options
    );
    const response = await fetch(request);
    if (!response.ok) {
      throw response;
    }
    return response.text();
  }
};

// 0x0st
export class OxOst extends FileHost {
  protected async sendFile(
    fileName: string,
    dataPromise: Promise<Blob>
  ): Promise<string> {
    const formData = new FormData();
    const data = await dataPromise;
    formData.append('file', data);
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'user-agent': userAgent,
      },
      body: formData,
    };
    const request = new Request('https://0x0.st', options);
    const response = await fetch(request);
    if (!response.ok) {
      throw new Error(`Response status: ${response.status}`);
    }
    return response.text();
  }
};

export default async function main(args: string[]): Promise<number> {
  let ret = 0;
  const options: util.ParseArgsOptionsConfig = {
    help: {
      type: 'boolean',
      short: 'h',
      default: false,
    },
    ['dry-run']: {
      type: 'boolean',
      short: 'n',
      default: false,
    },
  };

  try {
    const { values, positionals } = util.parseArgs(
      {options, args, allowPositionals: true}
    );
    if (values.help) {
      helpFlag();
    }
    if (positionals.length === 0) {
      throw new Error(`no input file`);
    }
    let host = new OxOst(!values['dry-run']);
    console.log(await host.upload(positionals[0]));
  } catch (error) {
    ret = typeof error === 'number' ? error : err(error as Error);
  };

  return ret;
}

function helpFlag() {
  const help =
    `${programName} v${programVersion}\n` +
    `usage:\n` +
    `\t${programName} -h\n` +
    `\t${programName} [-n] FILE [FILE ...]`;
  console.error(help);
  throw 0;
}

// err: prepend programName to an error message and return a UNIX exit value.
// 
// print error.message and return error.
function err(error: Error): number;
// print message and return exitValue.
function err(exitValue: number, message: string): number;
// print util.format(format, ...rest) and return exitValue.
function err(exitValue: number, format: string, ...rest: string[]): number;
function err(
  exitValue: number,
  format: string,
  ...rest: string[]
): number;
function err(
  errorOrExitValue: Error | number, // number in the range 0,255 inclusive.
  format?: string,
  ...rest: string[]
): number {
  let exitValue;
  if (errorOrExitValue instanceof Error) {
    exitValue = 1;
    format = errorOrExitValue.message;
  } else {
    exitValue = errorOrExitValue;
  }

  const printer = exitValue ? console.error : console.log;
  printer(`${programName}: ${util.format(format, ...rest)}`);

  return exitValue;
}
