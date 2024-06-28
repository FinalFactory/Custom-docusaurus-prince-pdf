#!/usr/bin/env node
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
import { parseArgs } from 'util';
import { exec } from 'child_process';
import fs from 'fs';
import path from 'path';
import jsdom from 'jsdom';
// const browser = new Browser()
const { JSDOM } = jsdom;
const buffer = new Set();
const __dirname = new URL('.', import.meta.url).pathname;
const { values, positionals } = parseArgs({
    args: process.argv,
    options: {
        /** Base URL, should be the `baseUrl` of the Docusaurus instance (e.g. https://docusaurus.io/docs/) */
        'url': {
            type: 'string',
            short: 'u',
        },
        /** CSS selector to find the link of the next page */
        'selector': {
            type: 'string',
            short: 's',
        },
        /** Working directory. Default to `./pdf` */
        'dest': {
            type: 'string',
            short: 'd',
            default: './pdf',
        },
        /** Change default list output filename */
        'file': {
            type: 'string',
            short: 'f',
        },
        /** Change PDF output filename */
        'output': {
            type: 'string',
            short: 'o',
        },
        /** Include passed URL in generated PDF */
        'include-index': {
            type: 'boolean',
        },
        /** Stop on next category URL */
        'category-stop': {
            type: 'boolean',
        },
        /** Exclude any url that matches the following string */
        'exclude': {
            type: 'string',
        },
        /** Prepend additional pages, split with comma */
        'prepend': {
            type: 'string',
        },
        /** Append additional pages, split with comma */
        'append': {
            type: 'string',
        },
        /** Additional options for Prince. ie. `--prince-args="--page-size='210mm 297mm'"` or `--prince-args "\\-\\-page\\-size='210mm 297mm'"` */
        'prince-args': {
            type: 'string',
        },
        /** Use external Prince docker image to generate PDF. See https://github.com/sparanoid/docker-prince for more info */
        'prince-docker': {
            type: 'boolean',
        },
        /** Fetch list without generating PDF */
        'list-only': {
            type: 'boolean',
        },
        /** Generate PDF without fetching list. Ensure list exists */
        'pdf-only': {
            type: 'boolean',
        },
        /** Specify the cookie with the domain part, e.g. `--cookie="token=123456; domain=example.com;"` */
        'cookie': {
            type: 'string',
        },
    },
    strict: true,
    allowPositionals: true,
});
const url = values.url ? values.url.replace(/\/$/, '') : 'https://dev.openbayes.com/docs';
const parsedUrl = new URL(url);
const baseUrl = parsedUrl.origin;
const scope = parsedUrl.pathname;
const scopeName = scope !== '/' ? `-${scope.replace(/\/$/g, '').replace(/^\//g, '').replace(/\//g, '-')}` : '';
const dest = values.dest;
const listFile = values.file || `${dest}/${parsedUrl.hostname}${scopeName}.txt`;
const pdfFile = values.output || `${dest}/${parsedUrl.hostname}${scopeName}.pdf`;
const fetchOptions = {};
function execute(cmd) {
    const s = (b) => String(b).trim();
    return new Promise((resolve, reject) => {
        exec(cmd, (error, stdout, stderr) => {
            if (error)
                return reject(error);
            resolve({ stdout: s(stdout), stderr: s(stderr) });
        });
    });
}
function generatePdf(list, filename, cookie) {
    return __awaiter(this, void 0, void 0, function* () {
        console.log(`Generating PDF ${filename}`);
        const args = values['prince-args'] || '';
        const cookieArg = cookie ? `--cookie "${cookie}"` : '';
        const princeCmd = values['prince-args']
            ? `docker run --rm -i -v ${__dirname}:/config sparanoid/prince --no-warn-css --style=/config/print.css ${cookieArg} --input-list=/config/${list} -o /config/${filename} ${args}`
            : `prince --no-warn-css --style=${__dirname}print.css ${cookieArg} --input-list=${list} -o ${filename} ${args} --page-size='210mm 297mm'`;
        console.log(`Executing command: ${princeCmd}`);
        // TODO: https://github.com/oven-sh/bun/issues/9747
        // await $`${princeCmd}`
        yield execute(princeCmd)
            .then((resp) => {
            console.log(resp.stdout);
            console.log(`Done`);
        })
            .catch((err) => {
            throw new Error(err);
        });
    });
}
function requestPage(url) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const resp = yield fetch(url, fetchOptions);
            const body = yield resp.text();
            // TODO: https://github.com/capricorn86/happy-dom/issues/1415
            // const page = browser.newPage()
            // page.url = url
            // page.content = body
            // const dom = page.mainFrame
            const dom = new JSDOM(body).window;
            const nextLinkEl = dom.document.body.querySelector(values.selector || '.pagination-nav__link--next');
            // TODO: jsdom does not have bultin DOM types.
            // Use `nextLinkEl instanceof HTMLAnchorElement` instead for happy-dom
            const nextLink = (nextLinkEl && 'href' in nextLinkEl && `${baseUrl}${nextLinkEl.href}`);
            const cycle = buffer.has(nextLink);
            // Filter nextLink based on exclude argument
            const excludePattern = values.exclude ? new RegExp(values.exclude, 'i') : null;
            var shouldExclude = excludePattern && excludePattern.test(nextLink);
            if (values['category-stop'] && nextLink && nextLink.includes('/category/')) {
                shouldExclude = true;
                console.log('Category stop detected!');
            }
            if (!cycle && nextLink && !shouldExclude) {
                const anchorElement = nextLinkEl;
                const nextLink = `${baseUrl}${anchorElement.href}`;
                console.log(`Got link: ${nextLink}`);
                buffer.add(nextLink);
                requestPage(nextLink);
            }
            else {
                if (cycle) {
                    console.log(`Pagination cycle detected on ${url}`);
                }
                else if (shouldExclude) {
                    console.log(`Excluded link: ${nextLink}`);
                }
                else {
                    console.log('No next link found!');
                }
                if (values.append) {
                    values.append.split(',').forEach((item) => __awaiter(this, void 0, void 0, function* () {
                        const url = item.match(/^https?:\/\//) ? item : `${baseUrl}${scope}${item}`;
                        //check if not already added
                        if (!buffer.has(url)) {
                            buffer.add(url);
                            console.log(`Got link: ${url} [append]`);
                        }
                    }));
                }
                if (buffer.size > 0) {
                    console.log(`Writing buffer (${buffer.size} links) to ${listFile}`);
                    yield fs.mkdir(path.dirname(listFile), { recursive: true }, (err) => __awaiter(this, void 0, void 0, function* () {
                        yield fs.writeFile(listFile, [...buffer].join('\n'), (err) => {
                            if (err) {
                                console.error('Error writing file:', err);
                            }
                            else {
                                console.log('File written successfully to', listFile);
                            }
                        });
                    }));
                    if (!values['list-only']) {
                        generatePdf(listFile, pdfFile, values.cookie);
                    }
                }
                else {
                    console.log('No buffer to write!');
                }
            }
        }
        catch (err) {
            console.error('Error fetching page:', err);
        }
    });
}
console.log(`Fetching ${url}....`);
if (values['category-stop']) {
    console.log('Category stop enabled!');
}
if (values['pdf-only']) {
    generatePdf(listFile, pdfFile, values.cookie);
}
else {
    if (values.prepend) {
        values.prepend.split(',').map((item) => {
            const url = item.match(/^https?:\/\//) ? item : `${baseUrl}${scope}${item}`;
            buffer.add(url);
            console.log(`Got link: ${url} [prepend]`);
        });
    }
    if (values['include-index']) {
        console.log(`Got link: ${baseUrl}${scope} [index]`);
        buffer.add(`${baseUrl}${scope}`);
    }
    requestPage(`${baseUrl}${scope}`);
}
