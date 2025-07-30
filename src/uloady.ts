import console from 'node:console';
import crypto from 'node:crypto';
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

type FileHostInfo = {
  constructor: Constructor<typeof FileHost>,
  maxFileSize: number,
};
type Constructor<T> =
  T extends abstract new (...args: infer P) => infer R ?
  new (...args: P) => R :
  never;
abstract class FileHost {
  // maxFileSize is the maximum file size allowed by the host.
  protected abstract readonly maxFileSize: number;
  // url is the full URL the request should be sent to.
  protected abstract readonly url: string;
  // formValues contains key: value pairs with the form data needed for
  // uploading a file.
  // The FileHost.dataToken symbol can be used to mark which key should contain
  // the file data.
  protected abstract readonly formValues: {
    [index: string]: string | symbol,
  };
  protected static readonly dataToken = Symbol('placeholder for data');


  // Maps the name to the constructor and limits of all subclasses.
  private static derivedClass = new Map<string, FileHostInfo>();
  protected static subClass(
    constructor: Constructor<typeof FileHost>,
    context: ClassDecoratorContext
  ) {
    let name = context.name as string;
    if (name === 'OxOst') {
      // Spaghetti because the class name can't start with a number.
      name = '0x0st';
    } else {
      name = name.toLowerCase();
    }

    let info: FileHostInfo = {
      constructor,
      maxFileSize: new constructor().maxFileSize,
    }
    FileHost.derivedClass.set(name, info);
  }
  private serviceName() {
    for (const [name, info] of FileHost.derivedClass) {
      if (info.constructor === this.constructor) {
        return name;
      }
    }
  }
  static service(
    serviceNames: undefined | string,
    fileName: string,
    fileSize: number,
  ): Constructor<typeof FileHost> {
    let services: typeof this.derivedClass;
    if (serviceNames === undefined) { // Set services to all the possible services.
      services = new Map(this.derivedClass);
    } else { // Set services to the subset of services picked by the user.
      let wantedServices = serviceNames.split(',').map((array) => array.trim());
      // Comma is optional for the last element.
      if (wantedServices[wantedServices.length-1] === '') {
        wantedServices.pop();
      }
      if (wantedServices.length === 1 && wantedServices[0] === 'default') {
        return this.service(undefined, fileName, fileSize);
      }
      services = new Map();
      for (const name of wantedServices) {
        let constructor = this.derivedClass.get(name);
        if (constructor === undefined) {
          throw new Error(`unknown service '${name}' in '${services}'`);
        }
        services.set(name, constructor);
      }
    }

    // Ensure all the services can handle the file's size.
    let maxFileSize = 0;
    for (const [name, info] of services) {
      maxFileSize = Math.max(maxFileSize, info.maxFileSize);
      if (fileSize > info.maxFileSize) {
        services.delete(name);
      }
    }
    if (services.size === 0) {
      throw new Error(
        `\n\tfile too large: '${fileName}'\n` +
        `\tfile size: ${getHumanFileSize(fileSize)}\n` +
        `\tmaximum size: ${getHumanFileSize(maxFileSize)}`
      );
    }

    let entry = services
      .entries()
      .drop(crypto.randomInt(services.size))
      .next()
      .value;
    const [_, info] = entry as NonNullable<typeof entry>;
    return info.constructor as ReturnType<typeof FileHost.service>;
  }
  async upload(fileName: string, data: Blob): Promise<string> {
    const formData = new FormData();
    for (const property in this.formValues) {
      let value = this.formValues[property];
      if (value === FileHost.dataToken) {
        formData.append(property, data, fileName);
      } else if (typeof value === 'string') {
        formData.append(property, value);
      } else {
        throw new Error(
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
  protected readonly maxFileSize = 200 * 1024 * 1024;
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
  protected readonly maxFileSize = 512 * 1024 * 1024;
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
  protected readonly maxFileSize = 128 * 1024 * 1024;
  protected readonly url: string = 'https://uguu.se/upload?output=text';
  protected readonly formValues = {'files[]': FileHost.dataToken};
};

@FileHost.subClass
export class PomfLain extends Uguu {
  // Undocumented, but it's just a pomf clone.
  // https://pomf.lain.la/f/faq.html
  protected readonly maxFileSize = 1024 * 1024 * 1024;
  protected readonly url = 'https://pomf.lain.la/upload.php?output=text';
}

export default async function main(args: string[]): Promise<number> {
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
      default: undefined,
    }
  };

  let flags, files;
  try {
    const { values, positionals } = util.parseArgs(
      {options, args, allowPositionals: true}
    );
    flags = values;
    files = positionals;

    if (flags.help) {
      helpFlag();
    }

    if (files.length === 0) {
      throw new Error(`no input file`);
    }
  } catch (error) {
    return typeof error === 'number' ? error : err(error as Error);
  };

  let ret = 0;
  for (const file of files) {
    try {
      const serviceNames = flags.service as undefined | string;
      let data;
      const baseName = path.basename(file);
      try {
        data = await fs.openAsBlob(file);
      } catch (error) {
        // Node doesn't include the filename in the error message.
        (error as Error).message = `unable to open '${baseName}' as Blob`;
        throw error;
      }
      let service = FileHost.service(serviceNames, baseName, data.size);
      let host = new service();
      console.log(await host.upload(path.extname(file), data));

    } catch (error) {
      err(error as Error);
      ret = 1;
    }
  }

  return ret;
}

function helpFlag() {
  const help =
    `${programName} v${programVersion}\n` +
    `usage:\n` +
    `\t${programName} -h\n` +
    `\t${programName} [-n] [-s SERVICE[,SERVICE ...]] FILE [FILE ...]`;
  console.error(help);
  throw 0;
}

function getHumanFileSize(fileSize: number) {
  const suffixes = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];

  let suffix;
  for (suffix of suffixes) {
    if (fileSize < 1024) {
      break;
    }
    fileSize /= 1024;
  }
  return fileSize.toPrecision(3) + (suffix as string);
}

// err: prepend programName to an error message and return a UNIX exit value.
// Doesn't exit because I don't know how I'd test the rest of the program
// properly if it was exiting all the time over monkeypatched implementations or
// deliberately wrong input.
//
// print error information and return an error exit code.
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
    // Typescript bug: it's missing the 'code' property for Error.
    let code = (errorOrExitValue as any)['code'] as string | undefined;
    format = `${errorOrExitValue.message}${code ? ': ' + code : ''}`;
  } else {
    exitValue = errorOrExitValue;
  }

  const printer = exitValue ? console.error : console.log;
  printer(`${programName}: ${util.format(format, ...rest)}`);

  return exitValue;
}
