#!/usr/bin/env node

import { parseArgs } from 'util'
import { exec } from 'child_process'
import fs from 'fs';
import path from 'path';

import jsdom from 'jsdom'
import { Browser, HTMLAnchorElement } from 'happy-dom'

// const browser = new Browser()
const { JSDOM } = jsdom
const buffer = new Set()

const __dirname = new URL('.', import.meta.url).pathname

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
})

const url = values.url ? values.url.replace(/\/$/, '') : 'https://dev.openbayes.com/docs'
const parsedUrl = new URL(url)
const baseUrl = parsedUrl.origin
const scope = parsedUrl.pathname
const scopeName =
  scope !== '/' ? `-${scope.replace(/\/$/g, '').replace(/^\//g, '').replace(/\//g, '-')}` : ''

const dest = values.dest
const listFile = values.file || `${dest}/${parsedUrl.hostname}${scopeName}.txt`
const pdfFile = values.output || `${dest}/${parsedUrl.hostname}${scopeName}.pdf`
const fetchOptions = {}

function execute(cmd: string): Promise<{
  stdout: string
  stderr: string
}> {
  const s = (b: string) => String(b).trim()

  return new Promise((resolve, reject) => {
    exec(cmd, (error, stdout, stderr) => {
      if (error) return reject(error)
      resolve({ stdout: s(stdout), stderr: s(stderr) })
    })
  })
}

async function generatePdf(list: string, filename: string, cookie?: string) {
  console.log(`Generating PDF ${filename}`)

  const args = values['prince-args'] || ''
  const cookieArg = cookie ? `--cookie "${cookie}"` : ''

  const princeCmd = values['prince-args']
    ? `docker run --rm -i -v ${__dirname}:/config sparanoid/prince --no-warn-css --style=/config/print.css ${cookieArg} --input-list=/config/${list} -o /config/${filename} ${args}`
    : `prince --no-warn-css --style=${__dirname}print.css ${cookieArg} --input-list=${list} -o ${filename} ${args} --page-size='210mm 297mm'`
  console.log(`Executing command: ${princeCmd}`)

  // TODO: https://github.com/oven-sh/bun/issues/9747
  // await $`${princeCmd}`

  await execute(princeCmd)
    .then((resp) => {
      console.log(resp.stdout)
      console.log(`Done`)
    })
    .catch((err) => {
      throw new Error(err)
    })
}

async function requestPage(url: string) {
  try {
    const resp = await fetch(url, fetchOptions)
    const body = await resp.text()

    // TODO: https://github.com/capricorn86/happy-dom/issues/1415
    // const page = browser.newPage()
    // page.url = url
    // page.content = body
    // const dom = page.mainFrame

    const dom = new JSDOM(body).window
    const nextLinkEl = dom.document.body.querySelector(
      values.selector || '.pagination-nav__link--next'
    )

    // TODO: jsdom does not have bultin DOM types.
    // Use `nextLinkEl instanceof HTMLAnchorElement` instead for happy-dom
    const nextLink = (nextLinkEl && 'href' in nextLinkEl && `${baseUrl}${nextLinkEl.href}`) as string
    const cycle = buffer.has(nextLink)

    // Filter nextLink based on exclude argument
    const excludePattern = values.exclude ? new RegExp(values.exclude, 'i') : null
    var shouldExclude = excludePattern && excludePattern.test(nextLink)

    if (values['category-stop'] && nextLink && nextLink.includes('/category/')) 
    {
      shouldExclude = true
      console.log('Category stop detected!')
    }

    if (!cycle && nextLink && !shouldExclude) {
      const anchorElement = nextLinkEl as unknown as HTMLAnchorElement;
      const nextLink = `${baseUrl}${anchorElement.href}`
      console.log(`Got link: ${nextLink}`)

      buffer.add(nextLink)
      requestPage(nextLink)
    } else {
      if (cycle) {
        console.log(`Pagination cycle detected on ${url}`)
      } else if (shouldExclude) {
        console.log(`Excluded link: ${nextLink}`)
      } else {
        console.log('No next link found!')
      }

      if (values.append) {
        values.append.split(',').forEach(async (item) => {
          const url = item.match(/^https?:\/\//) ? item : `${baseUrl}${scope}${item}`
          //check if not already added
          if (!buffer.has(url))
          {
            buffer.add(url)
            console.log(`Got link: ${url} [append]`)
          }
        })
      }

      if (buffer.size > 0) {
        console.log(`Writing buffer (${buffer.size} links) to ${listFile}`)
        await fs.mkdir(path.dirname(listFile), { recursive: true }, async (err) => {
          await fs.writeFile(listFile, [...buffer].join('\n'), (err) => {
            if (err) {
              console.error('Error writing file:', err);
            } else {
              console.log('File written successfully to', listFile);
            }
          })
        })

        if (!values['list-only']) {
          generatePdf(listFile, pdfFile, values.cookie)
        }
      } else {
        console.log('No buffer to write!')
      }
    }
  } catch (err) {
    console.error('Error fetching page:', err)
  }
}
console.log(`Fetching ${url}....`)
if (values['category-stop'])
  {
    console.log('Category stop enabled!')
  }
if (values['pdf-only']) {
  generatePdf(listFile, pdfFile, values.cookie)
} else {
  if (values.prepend) {
    values.prepend.split(',').map((item) => {
      const url = item.match(/^https?:\/\//) ? item : `${baseUrl}${scope}${item}`
      buffer.add(url)
      console.log(`Got link: ${url} [prepend]`)
    })
  }

  if (values['include-index']) {
    console.log(`Got link: ${baseUrl}${scope} [index]`)
    buffer.add(`${baseUrl}${scope}`)
  }

  requestPage(`${baseUrl}${scope}`)
}
