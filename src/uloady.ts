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
  default: boolean,
};
type Constructor<T> =
  T extends abstract new (...args: infer P) => infer R ?
  new (...args: P) => R :
  never;
// Useful link to find more hosts to add:
// https://github.com/ShareX/CustomUploaders
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
  // default states whether the service should be on by default.
  protected readonly default: boolean = true;
  // responseFixup controls the post processing done to the server response body
  // to produce the final url.
  protected readonly responseFixup = (res: string) => res.trim();
  // fileNameFixup controls the filename sent to the server.
  // Some servers use the basename somewhere.
  // Some servers use the extname to decide the file url's extension.
  // Some servers don't use the filename for anything.
  // The intention is to send the least information possible.
  protected readonly fileNameFixup = (name: string) =>
    path.extname(name).trim();

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

    let service = new constructor();
    let info: FileHostInfo = {
      constructor,
      maxFileSize: service.maxFileSize,
      default: service.default,
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
    let services: typeof this.derivedClass = new Map();
    if (serviceNames === undefined) { // Set services to all the possible services.
      for (const [name, info] of services) {
        if (info.default) {
          services.set(name, info);
        }
      }
    } else { // Set services to the subset of services picked by the user.
      let wantedServices = serviceNames.split(',').map((array) => array.trim());
      // Comma is optional for the last element.
      if (wantedServices[wantedServices.length-1] === '') {
        wantedServices.pop();
      }
      if (wantedServices.length === 1 && wantedServices[0] === 'default') {
        return this.service(undefined, fileName, fileSize);
      }
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
        `\n\tfile too large: '${path.basename(fileName)}'\n` +
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
        formData.append(property, data, this.fileNameFixup(fileName));
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
      return response.text().then(value => this.responseFixup(value));
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

@FileHost.subClass
export class LewdPics extends FileHost {
  // Undocumented: https://lewd.pics/p/
  //
  // curl -L -F fileToUpload=@/tmp/test_image.png -F curl2=1 https://lewd.pics/p/
  // When curl2=1 is set in the formData, the server replies in plaintext
  // with a link to an indirect download page as such:
  // https://lewd.pics/p/?i=PW2o.png
  // All that is needed to make it direct is to remove the "?i=", e.g.:
  // https://lewd.pics/p/PW2o.png
  protected readonly maxFileSize = 25 * 1024 * 1024;
  protected readonly url = 'https://lewd.pics/p/';
  protected readonly formValues = {
    exifData: 'no', // 'Discard Exif Data' checkbox.
    curl2: "1", // When this is set, the server sends a plaintex reply
    fileToUpload: FileHost.dataToken,
  };
  protected readonly responseFixup = (response: string) => {
    return response.replace('?i=', '');
  }
  protected readonly default = false;
}

@FileHost.subClass
export class GoFileIO extends FileHost {
  // Documentation: https://gofile.io/api
  //
  // Server response looks like this:
  // {"data":{"createTime":1753917377,"downloadPage":"https://gofile.io/d/kJ6fm8","guestToken":"YdZ5fjNEK4toR5HxyoXodN74qukoncuf","id":"e882ca92-8338-4a20-8371-b11e25ae7353","md5":"074929ca061af7af3dc91725857daa51","mimetype":"image/png","modTime":1753917377,"name":"test_image.png","parentFolder":"ba6f643d-8805-48c0-8834-e7e1c2e86cac","parentFolderCode":"kJ6fm8","servers":["store8"],"size":238,"type":"file"},"status":"ok"}
  //
  protected readonly maxFileSize = 50 * 1024 * 1024 * 1024; // Unknown.
  protected readonly url = 'https://upload.gofile.io/uploadfile';
   protected readonly formValues = {
    'file': FileHost.dataToken,
  }
  protected readonly fileNameFixup = (fileName: string) => {
    return path.basename(fileName).trim();
  }
  protected readonly responseFixup = (response: string) => {
    const json = JSON.parse(response);
    return json.data.downloadPage;
  }
  protected readonly default = false
}

@FileHost.subClass
export class PutNu extends FileHost {
  // Undocumented: https://put.nu
  //
  // Strangely, the filename seems to dictate how long the file is hosted for.
  // 0.ext = 1 hour
  // 1.ext = 3 days
  // 2.ext = 1 week
  // 3.ext = 1 month
  // 4.ext = 3 months
  // 5.ext = eternity
  // The extension is only used to set the url's extension, it doesn't dictate
  // the file's duration.
  protected readonly maxFileSize = 50 * 1024 * 1024 * 1024; // Unknown.
  protected readonly url = 'http://put.nu/py/main.py'; // UNENCRYPTED!
  protected readonly formValues = {
    file: FileHost.dataToken,
  }
  protected readonly fileNameFixup = (fileName: string) => {
    const oneMonth = '3';
    return oneMonth + path.extname(fileName).trim();
  }
  protected readonly responseFixup = (response: string) => {
    // The 3rd line contains:
    // <a href="http://put.nu/files/81l-xsO.png"><p>http://put.nu/files/81l-xsO.png</p></a>
    return response.split('"', 6)[5];
  }
}

@FileHost.subClass
export class QuestionableLink extends FileHost {
  // Documentation: https://questionable.link/api/docs/#post-/files/create
  // Source code: https://github.com/jacobhumston/sxcu.api
  // This is an alternate domain to sxcu.net, files uploaded to one appear on the
  // other. I picked this domain because it's funny.
  // Replace sxcu.net with questionable.link wherever you see it in the
  // documentation.
  // I noticed "noembed" has "void" type in the documentation but it's actually
  // just a boolean converted to a string according to the source code.
  protected readonly maxFileSize = 95 * 1024 * 1024;
  protected readonly url = 'https://questionable.link/api/files/create';
  protected readonly formValues = {
    file: FileHost.dataToken,
    noembed: 'true',
  }
  protected readonly responseFixup = (response: string) => {
    const json = JSON.parse(response);
    return json.url;
  }
  protected readonly default = false
}

@FileHost.subClass
export class TempSh extends FileHost {
  // Documentation: https://temp.sh/
  //
  // curl -F "file=@test.txt" https://temp.sh/upload
  // There is only a preview page.
  protected readonly maxFileSize = 4 * 1024 * 1024 * 1024;
  protected readonly url = 'https://temp.sh/upload';
  protected readonly formValues = {
    file: FileHost.dataToken,
  }
  protected readonly fileNameFixup = (name: string) => {
    return path.basename(name);
  }
  protected readonly responseFixup = (response: string) => {
    return response.replace(/^http:\/\//, 'https://');
  }
}

@FileHost.subClass
export class Blicky extends FileHost {
  // Undocumented. Selecting a file for upload says the file size limit is
  // 100MiB. https://f.blicky.net
  //
  // To upload:
  // curl -F file=@/tmp/test_image.png https://f.blicky.net/script.php
  //
  // The server response is 2 lines:
  // The first line is $FILE_HASH. It uniquely identifies the file.
  // The second line is $DELETE_CODE. It allows deleting the file.
  //
  // Using the $FILE_HASH and $DELETE_PASS, as in shell syntax, you can
  // construct the following URLs:
  //
  // Indirect download URL: https://f.blicky.net/f.php?h=${FILE_HASH}
  // Browser preview URL: https://f.blicky.net/f.php?h=${FILE_HASH}&p=1
  // Direct download URL: https://f.blicky.net/f.php?h=${FILE_HASH}&d=1
  // Delete URL: https://f.blicky.net/f.php?h=${FILE_HASH}&d=${DELETE_PASS}
  //
  // The server uses the filename in the indirect page and in the direct
  // download.
  //
  // Currently has issues because we don't set Content-Type properly, for this
  // Blob.type needs to be set on construction.
  // The issues are that the preview link will download the file for all files.
  // Additionally, the indirect download URL is supposed to contain a link to
  // the preview when applicable, and it doesn't.
  protected readonly maxFileSize = 100 * 1024 * 1024;
  protected readonly url = 'https://f.blicky.net/script.php';
  protected readonly formValues = {
    file: FileHost.dataToken,
  }
  protected readonly responseFixup = (body: string) => {
    body = body.slice(0, body.search('\n'));
    return 'https://f.blicky.net/f.php?h=' + body + '&p=1';
  }
  protected readonly fileNameFixup = (fileName: string) => {
    return path.basename(fileName).trim();
  }
  protected readonly default = false;
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
      console.log(await host.upload(file, data));

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
