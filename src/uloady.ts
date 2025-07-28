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
  private static derivedConstructors: Record<string, new () => FileHost> = {};
  protected static subClass(
    constructor: new () => FileHost,
    context: ClassDecoratorContext
  ) {
    let name = context.name as string;
    if (name === 'OxOst') {
      // Spaghetti because the class name can't start with a number.
      name = '0x0st';
    } else {
      name = name.toLowerCase();
    }

    FileHost.derivedConstructors[name] = constructor;
  }
  static service(service: string): new () => FileHost {
    return this.derivedConstructors[service];
  }
  protected static readonly dataToken = Symbol('placeholder for data');

  protected abstract readonly url: string;
  protected abstract readonly formValues: {
    [index: string]: string | symbol,
  };

  async upload(fileName: string): Promise<string> {
    const formData = new FormData();
    for (const property in this.formValues) {
      let value = this.formValues[property];
      if (value === FileHost.dataToken) {
        formData.append(
          property,
          await fs.openAsBlob(fileName),
          path.extname(fileName)
        );
      } else if (typeof value === 'string') {
        formData.append(property, value);
      } else {
        throw new TypeError(
          `form key ${property} value ${String(value)}` +
          ` of type ${typeof value} isn't valid`
        );  
      }
    }
    const options: RequestInit = {
      method: 'POST',
      headers: {
        'user-agent': userAgent,
      },
      body: formData,
    };
    const request = new Request(this.url, options);
    if (!this.dryRun) {
      const response = await fetch(request);
      if (!response.ok) {
        throw response;
      }
      return response.text().then(value => value.trim());
    }
    return "dry run";
  }

  constructor(private dryRun: boolean = false) {
  }
};

@FileHost.subClass
export class Catbox extends FileHost {
  // Documentation: https://catbox.moe/tools.php
  protected readonly url = 'https://catbox.moe/user/api.php';
  protected readonly formValues = {
    reqtype: 'fileupload',
    fileToUpload: FileHost.dataToken,
  }
};

// 0x0st
@FileHost.subClass
export class OxOst extends FileHost {
  // Documentation: https://0x0.st
  protected readonly url: string = 'https://0x0.st';
  protected readonly formValues = {file: FileHost.dataToken};
};

@FileHost.subClass
export class X0at extends OxOst {
  // Documentation: https://x0.at
  protected readonly url = 'https://x0.at';
};

@FileHost.subClass
export class Uguu extends FileHost {
  // Documentation: https://uguu.se/api
  protected readonly url = 'https://uguu.se/upload?output=text';
  protected readonly formValues = {'files[]': FileHost.dataToken};
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
    service: {
      type: 'string',
      short: 's',
      default: 'uguu'
    }
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
    let serviceName = values['service'] as string;
    let service = FileHost.service(serviceName);
    if (typeof service === 'undefined') {
      throw new Error(`invalid service '${serviceName}'`)
    }
    let host = new service();
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
// Doesn't exit because I don't know how I'd test the rest of the program
// properly if it was exiting all the time over monkeypatched implementations or
// deliberately wrong input.
// 
// print error.message and return an error exit code.
function err(error: Error): number;
// print message and return exitValue.
function err(exitValue: number, message: string): number;
// print util.format(format, ...rest) and return exitValue.
function err(exitValue: number, format: string, ...rest: string[]): number;
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
