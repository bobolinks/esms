/* eslint-disable @typescript-eslint/ban-ts-comment */
import fs from 'fs';
import path from 'path';
import ts from 'typescript';

export function lookupModule(root: string, filepath: string): string | undefined {
  if (filepath.indexOf('/') !== -1) {
    const fp = path.join(root, 'node_modules', filepath);
    if (fs.existsSync(fp) && fs.statSync(fp).isFile()) {
      return `/node_modules/${filepath}`;
    } if (fs.existsSync(`${fp}.ts`)) {
      return `/node_modules/${filepath}.ts`;
    } if (fs.existsSync(`${fp}.js`)) {
      return `/node_modules/${filepath}.js`;
    } if (fs.existsSync(`${fp}.json`)) {
      return `/node_modules/${filepath}.json`;
    }
  }
  const filePack = path.join(root, 'node_modules', filepath, 'package.json');
  if (!fs.existsSync(filePack)) {
    return undefined;
  }
  const pack = JSON.parse(fs.readFileSync(filePack, 'utf-8'));
  const relFileModule = pack.module || pack.main || 'index.js';
  const fileModule = path.join(root, 'node_modules', filepath, relFileModule);
  if (!fs.existsSync(fileModule)) {
    return undefined;
  }
  return `/node_modules/${filepath}/${relFileModule}`;
}

function isExportDefault(node: ts.Declaration): boolean {
  const modifier = ts.ModifierFlags.ExportDefault;
  return (ts.getCombinedModifierFlags(node) & modifier) === modifier;
}

function getIdentifiersByName(context: ts.TransformationContext, container: ts.Node, name: string) {
  const nodes: Array<ts.Node> = [];
  const visitor: ts.Visitor = function (this: any, node: ts.Node): ts.Node {
    if (node.kind === ts.SyntaxKind.Identifier && (node as any).text === name) {
      nodes.push(node);
    }
    return ts.visitEachChild(node, visitor, context);
  };
  ts.visitNode(container, visitor);
  return nodes;
}

export default function (root: string, filepath: string, code: string): string {
  let hasExported = false;
  const identifiers: Record<string, { node: ts.Identifier, count: number }> = {};

  const normalizePath: ts.TransformerFactory<ts.SourceFile> = context => {
    const { factory } = context;
    let level = 0;
    return sourceFile => {
      const nodes: any = [];
      const visitor: ts.Visitor = function (this: any, node: ts.Node): ts.Node {
        if (ts.isVariableStatement(node)) {
          const stmt = node as ts.VariableStatement;
          const decls = stmt.declarationList.declarations;
          if (decls.length === 1 && decls[0].initializer) {
            if (ts.isCallExpression(decls[0].initializer)) {
              const decl = decls[0] as ts.VariableDeclaration;
              const expr = decl.initializer as ts.CallExpression;
              if ((expr as any).expression.text === 'require') {
                const name = decl.name;
                if (ts.isObjectBindingPattern(name)) {
                  const nameFmt = name.getText().replace(/[^0-9a-z]/ig, '_');
                  const cause = factory.createImportClause(false, factory.createIdentifier(nameFmt), undefined);
                  const newNode = factory.createImportDeclaration(undefined, undefined, cause, expr.arguments[0]);
                  nodes.push(newNode);
                  const newDecl = factory.createVariableDeclaration(decl.name, decl.exclamationToken, undefined, factory.createIdentifier(nameFmt));
                  const newDels = factory.createVariableDeclarationList([newDecl]);
                  const newStmt = factory.createVariableStatement(undefined, newDels);
                  nodes.push(newStmt);
                  return newNode;
                } else {
                  const cause = factory.createImportClause(false, factory.createIdentifier(name.getText()), undefined);
                  const newNode = factory.createImportDeclaration(undefined, undefined, cause, expr.arguments[0]);
                  nodes.push(newNode);
                  return newNode;
                }
              }
            }
          }
        } else if (ts.isImportDeclaration(node)) {
          const fileName = (node as any).moduleSpecifier.text;
          if (/^@\//.test(fileName)) {
            const spec = factory.createStringLiteral(`/src/${fileName.substring(2)}`);
            const newNode = factory.createImportDeclaration(node.decorators, node.modifiers, node.importClause, spec);
            nodes.push(newNode);
            return newNode;
          } else if (/^[^./]/.test(fileName)) {
            const newPath = lookupModule(root, fileName);
            if (newPath === undefined) {
              if (node.importClause?.name) {
                // create an variable statement
                const emptyObject = factory.createObjectLiteralExpression();
                const newDecl = factory.createVariableDeclaration(node.importClause.name, undefined, undefined, emptyObject);
                const newDels = factory.createVariableDeclarationList([newDecl]);
                const newNode = factory.createVariableStatement(undefined, newDels);
                nodes.push(newNode);
              }
            } else if (newPath !== fileName) {
              const spec = factory.createStringLiteral(newPath);
              const newNode = factory.createImportDeclaration(node.decorators, node.modifiers, node.importClause, spec);
              nodes.push(newNode);
              return newNode;
            }
          } else if (!/\.(css|wxss)$/.test(fileName)) {
            const spec = factory.createStringLiteral(`${fileName}`);
            const newNode = factory.createImportDeclaration(node.decorators, node.modifiers, node.importClause, spec);
            nodes.push(newNode);
            return newNode;
          }
        } else if (ts.isExportAssignment(node)) {
          hasExported = true;
        } else if (ts.isFunctionDeclaration(node) && isExportDefault(node)) {
          hasExported = true;
        } else if (ts.isClassDeclaration(node) && isExportDefault(node)) {
          hasExported = true;
        } else if (ts.isExportDeclaration(node)) {
          hasExported = true;
          if (node.moduleSpecifier) {
            const fileName = (node as any).moduleSpecifier.text;
            if (/^@\//.test(fileName)) {
              const spec = factory.createStringLiteral(`/src/${fileName.substring(2)}`);
              const newNode = factory.createExportDeclaration(node.decorators, node.modifiers, node.isTypeOnly, node.exportClause, spec);
              nodes.push(newNode);
              return newNode;
            } else if (/^[^./]/.test(fileName)) {
              const newPath = lookupModule(root, fileName);
              if (newPath && newPath !== fileName) {
                const spec = factory.createStringLiteral(newPath);
                const newNode = factory.createExportDeclaration(node.decorators, node.modifiers, node.isTypeOnly, node.exportClause, spec);
                nodes.push(newNode);
                return newNode;
              }
            }
          }
        }

        if (level === 1) {
          nodes.push(node);
          return node;
        }
        level++;
        const rs = ts.visitEachChild(node, visitor, context);
        level--;
        return rs;
      };

      ts.visitNode(sourceFile, visitor);
      return factory.updateSourceFile(sourceFile, nodes);
    };
  };
  const parseIndentifier: ts.TransformerFactory<ts.SourceFile> = context => {
    const { factory } = context;
    return sourceFile => {
      const nodes: any = [];
      const visitor: ts.Visitor = function (this: any, node: ts.Node): ts.Node {
        if (ts.isIdentifier(node) && !ts.isImportSpecifier(node.parent)) {
          const name = (node as any).escapedText;
          if (name) {
            (identifiers[name] || (identifiers[name] = { node, count: 0 })).count++;
          }
          ts.isTypeNode(node.parent);
        }
        return ts.visitEachChild(node, visitor, context);
      };

      return ts.visitNode(sourceFile, visitor);
    };
  };
  const removeUnusedImports: ts.TransformerFactory<ts.SourceFile> = context => {
    const { factory } = context;
    return sourceFile => {
      const visitor: ts.Visitor = function (this: any, node: ts.Node): ts.Node {
        if (ts.isImportDeclaration(node)) {
          const imp = node as ts.ImportDeclaration;
          let changed = false;
          let name = imp.importClause?.name;
          let namedBindings = imp.importClause?.namedBindings as ts.NamedImports;
          if (name && !identifiers[imp.importClause.name.text]) {
            name = undefined;
            changed = true;
          }
          if (namedBindings && ts.isNamedImports(namedBindings)) {
            const es = namedBindings.elements.filter(e => identifiers[e.name.text]);
            if (!changed && es.length !== namedBindings.elements.length) changed = true;
            namedBindings = factory.createNamedImports(es);
          }
          if (changed) {
            return factory.updateImportDeclaration(node, node.decorators, node.modifiers, factory.createImportClause(false, name, namedBindings), node.moduleSpecifier);
          }
          return ts.visitEachChild(node, visitor, context);
        }
        return ts.visitEachChild(node, visitor, context);
      };

      return ts.visitNode(sourceFile, visitor);
    };
  };
  // `const {a,b} = require("asd");`
  const transformers = [normalizePath,];
  let src = ts.transpileModule(code, {
    transformers: {
      before: transformers,
      after: [parseIndentifier, removeUnusedImports]
    },
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ESNext,
    }
  }).outputText;

  if (!hasExported) {
    src = `var exports = {};\nvar module = {exports};\n${src}\nexport default exports.default || module.exports;\n`;
  }

  return src;
}
