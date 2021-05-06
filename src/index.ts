import fs from 'fs';
import path from 'path';
import mime from 'mime';
import stream from 'stream';
import express, { Express } from 'express';
import tsTransformer, { lookupModule } from './transformers/ts';

function parseHttpDate(date: string) {
  const timestamp = date && Date.parse(date);

  return typeof timestamp === 'number'
    ? timestamp
    : NaN;
}

export interface EsmsPlugin {
  test: RegExp;
  transform(context: EsmServer, path: string, content?: string): string;
};

export interface EsmsOptions {
  port: number;
  index?: string;
  plugins?: Array<EsmsPlugin>;
}

export class EsmServer {
  root: string;
  expr: Express;
  app: any;
  options: EsmsOptions;

  constructor(root: string, options?: EsmsOptions) {
    this.root = root;
    this.expr = express();
    this.options = options || { port: 80 };

    if (!fs.existsSync(this.root)) {
      throw 'root not found!';
    }

    this.expr.all('*', (req, res, next) => {
      res.header('Access-Control-Allow-Origin', '*');
      res.header('Access-Control-Allow-Headers', 'Content-Type,Content-Length, Authorization, Accept,X-reqed-With');
      res.header('Access-Control-Allow-Methods', 'PUT,POST,GET,DELETE,OPTIONS');
      if (req.method === 'OPTIONS') {
        res.end('OK');
      } else {
        next();
      }
    });

    // default page
    this.expr.get('/', (_req, res) => {
      res.redirect(this.options.index || 'index.html');
    });

    // handle with rules
    this.expr.use('/', (req, res, next) => {
      let filePath = path.resolve(this.root, req.path.replace(/^\/+/, ''));
      let filePathRel = req.path;
      if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
        let found = false;
        for (const it of ['.ts', '.js']) {
          if (fs.existsSync(filePath + it)) {
            filePath = `${filePath}${it}`;
            filePathRel = `${filePathRel}${it}`;
            found = true;
            break;
          }
        }
        if (!found && /^\/node_modules\//.test(filePathRel)) {
          const newPath = lookupModule(this.root, filePathRel.substring(14));
          if (newPath) {
            filePathRel = newPath.substring(21);
            filePath = path.resolve(this.root, filePathRel.substring(1));
            found = true;
          }
        }
        if (!found) {
          console.warn(`[${req.url}] not found!`);
          res.statusCode = 404;
          return res.end();
        }
      }
      const [, ext] = /(\.[^.]+)$/.exec(filePath) || [];
      if (!ext || ['.css', '.js', '.ts', '.json'].indexOf(ext.toLocaleLowerCase()) === -1) {
        return next();
      }
      const stats = fs.statSync(filePath);
      const unmodifiedSince = parseHttpDate(req.header('if-modified-since') || '');
      // if-unmodified-since
      if (!isNaN(unmodifiedSince) && stats.mtimeMs > unmodifiedSince) {
        res.statusCode = 304;
        return res.end();
      }
      let src = fs.readFileSync(filePath, 'utf-8');
      let mimeType = '';
      if (/\.(js|ts)$/.test(filePath)) {
        mimeType = 'application/javascript';
        src = tsTransformer(this.root, filePathRel, src);
      } else if (/\.json$/.test(filePath) && req.header('Sec-Fetch-Dest') === 'script') {
        mimeType = 'application/javascript';
        src = `
        export default ${src};
        `;
      }

      for (const transformer of (this.options.plugins || [])) {
        if (!transformer.test.test(filePathRel)) continue;
        src = transformer.transform(this, filePathRel, src) || src;
      }

      const fileContents = Buffer.from(src, "utf-8");
      const readStream = new stream.PassThrough();
      readStream.end(fileContents);

      res.set('Content-disposition', 'attachment; filename=' + path.basename(filePath));
      res.set('Content-Type', `${mimeType || mime.lookup(filePath)}; charset=UTF-8`);
      res.set('Last-Modified', stats.mtime.toUTCString());
      if (/^\/node_modules\//.test(filePathRel)) {
        res.set('Cache-Control', 'max-age=100000');
      } else {
        res.set('Cache-Control', ['no-cache', 'no-store', 'must-revalidate', 'max-age=0']);
      }
      readStream.pipe(res);
    });

    // handle static file
    this.expr.use('/', express.static(this.root));
  }

  start() {
    const app = this.expr.listen(this.options.port, () => {
      if (app) {
        console.log(`listening on: http://localhost:${this.options.port}`);
      } else {
        console.error('failed to listen');
      }
    });
    this.app = app;
  }
};
