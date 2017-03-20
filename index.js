'use strict'

const fs = require('fs')
const path = require('path')
const del = require('delete')
const unzip = require('unzip')
const xml2js = require('xml2js')
const chalk = require('chalk')
const copydir = require('copy-dir')
const archiver = require('archiver')

const baseFilePath = './test/fixtures/sheet-origin.ods'
const updatedFilePath = './test/fixtures/sheet-modified.ods'

const CELL_STYLE_ADDED_LINE = 'odsdiff_addedline'
const CELL_STYLE_ADDED_LINE_COLOR = '#00ff66'

const CELL_STYLE_REMOVED_LINE = 'odsdiff_removedline'
const CELL_STYLE_REMOVED_LINE_COLOR = '#ff9999'

odsDiff(baseFilePath, updatedFilePath)

module.exports = odsDiff

function odsDiff (baseFilePath, updatedFilePath) {
  const baseFilePathParsed = path.parse(baseFilePath)
  const updatedFilePathParsed = path.parse(updatedFilePath)

  const outputFileName = baseFilePathParsed.name.concat('__diff__', updatedFilePathParsed.name, baseFilePathParsed.ext)
  const outputFilePath = path.join(baseFilePathParsed.dir, outputFileName)
  const outputFilePathParsed = path.parse(outputFilePath)

  const baseExtractedDir = path.join(baseFilePathParsed.dir, baseFilePathParsed.name.concat('_files'))
  const updatedExtractedDir = path.join(updatedFilePathParsed.dir, updatedFilePathParsed.name.concat('_files'))
  const outputExtractedDir = outputFilePath.concat('_files')
  //
  // const intermediateOriginCSV = path.join(baseFilePathParsed.dir, baseFilePathParsed.name.concat('.csv'))
  // const intermediateUpdatedCSV = path.join(updatedFilePathParsed.dir, updatedFilePathParsed.name.concat('.csv'))
  // const intermediateDiffCSV = path.join(outputFilePathParsed.dir, outputFilePathParsed.name.concat('.csv'))

  const baseXmlFilePath = path.join(baseExtractedDir, 'content.xml')
  const updatedXmlFilePath = path.join(updatedExtractedDir, 'content.xml')
  const outputXmlFilePath = path.join(outputExtractedDir, 'content.xml')

  console.log(chalk.blue('\n---'))
  console.log(chalk.blue('ods-diff: Make a diff between two .ods files.'))
  console.log(chalk.blue('MIT © Groupe SIRAP (https://github.com/sirap-group/node-ods-diff)'))
  console.log('> Original file path: ' + path.resolve(baseFilePath))
  console.log('> Modified file path: ' + path.resolve(updatedFilePath))
  console.log('> output file path:    ' + path.resolve(outputFilePath))
  console.log(chalk.blue('---\n'))

  // Clean dir and unzip ods files to handle their XML content
  Promise.all([
    del.promise([baseExtractedDir])
    .then(() => extractFile(baseFilePath, baseExtractedDir)),

    del.promise([updatedExtractedDir])
    .then(() => extractFile(updatedFilePath, updatedExtractedDir))
  ])

  // prepare the source files directory output
  .then(() => {
    console.log(chalk.blue('Create a working directory for the output source files, a copy of the updated ods extraction folder:\n') + '  ' + outputExtractedDir)
    return new Promise((resolve, reject) => {
      copydir(updatedExtractedDir, outputExtractedDir, (err) => {
        if (err) {
          reject(err)
          return
        }
        console.log('> ' + chalk.green('Output source folder created: ' + outputExtractedDir))
        resolve()
      })
    })
  })

  // compare the file's content
  .then(() => compareContentFiles(baseXmlFilePath, updatedXmlFilePath))

  // Write the output XML
  .then((updatedOds) => {
    let builder = new xml2js.Builder()
    let xml = builder.buildObject(updatedOds)
    return new Promise((resolve, reject) => {
      console.log(chalk.blue('\nWriting destination output: ') + outputXmlFilePath + '...')
      fs.writeFile(outputXmlFilePath, xml, 'utf8', (err) => {
        if (err) {
          console.error(chalk.red("Can't write updatedOds XML in output destination file: " + outputXmlFilePath))
          reject(err)
          return
        }

        console.log(chalk.green('Destination output written: ') + outputXmlFilePath + '...')
        resolve()
      })
    })
  })

  // Build the resulting .ods file
  .then(() => {
    console.log(chalk.blue('\nBuild the ods file from the intermediate working folder: \n  > ') + outputExtractedDir + chalk.blue(' => ') + outputFilePath + chalk.blue('...'))
    return new Promise((resolve, reject) => {
      let outputOds = fs.createWriteStream(outputFilePath)
      let archive = archiver('zip')

      outputOds.on('close', () => {
        console.log(chalk.green('Build of the output ods was succesfuly written: ') + outputFilePath)
        resolve()
      })
      archive.on('error', (err) => {
        console.error(chalk.red('ERROR: Fail to generate the ods file while ziping the source files: ' + outputExtractedDir + ' => ' + outputFilePath))
        reject(err)
      })
      archive.pipe(outputOds)
      archive.directory(outputExtractedDir, '/', {
        name: ''
      })
      archive.finalize()
    })
  })

  // clear the intermediate files
  // .then(() => Promise.all([
  //   del.promise([baseExtractedDir]),
  //   del.promise([updatedExtractedDir]),
  //   del.promise([outputExtractedDir])
  // ]))

  // Log script results
  .then(() => console.log(chalk.green('DONE.')))
  .catch((err) => {
    console.error(chalk.red(err))
    console.error(err.stack)
  })
}

function extractFile (input, output) {
  return new Promise(function (resolve, reject) {
    console.log(chalk.blue('Read stream and extract: ') + input + ' ...')

    fs.createReadStream(input)
    .pipe(unzip.Extract({ path: output }))
    .on('close', function (err) {
      if (err) {
        reject(err)
      } else {
        console.log('> ' + chalk.green('EXTRACTED') + ': ' + input + chalk.blue(' > ') + output)
        resolve()
      }
    })
  })
}

function compareContentFiles (originPath, updatedPath) {
  let originOdsSheets, updatedOdsSheets, updatedOds

  return parseFile(originPath).then((ods) => originOdsSheets = getDocumentSheets(ods))
  .then(() => parseFile(updatedPath)).then((ods) => {
    updatedOds = ods
    updatedOdsSheets = getDocumentSheets(ods)
    setDiffStyles(ods)
  })
  .then(() => {
    if (originOdsSheets.length !== updatedOdsSheets.length) {
      throw new Error('ERROR: The two ods files has not the same number of sheets.')
    } else {
      console.log(chalk.blue('\nNumber of sheet to compare : ') + originOdsSheets.length + '\n')
    }
  })
  .then(() => {
    // console.dir({originOdsSheets}, {depth: 7, colors: true})
    // console.dir({updatedOdsSheets}, {depth: 7, colors: true})
  })

  // Convert the two docs to csv
  .then(() => {
    // orinal csv
    convertOdsSheetsToCsvFiles(originOdsSheets, originPath)

    // updated csv
    convertOdsSheetsToCsvFiles(updatedOdsSheets, updatedPath)
  })
  .thenResolve(updatedOds)
}

function convertOdsSheetsToCsvFiles (sheets, basePath) {
  sheets.forEach((sheet, sheetIndex) => {
    let filePath = basePath.concat('_sheet#', sheetIndex, '.csv')
    let ws = fs.createWriteStream(filePath)
    console.log(chalk.blue('Writing CSV file: ') + filePath)
    getSheetRows(sheet).forEach((row) => {
      if (row) {
        getRowCells(row).forEach((cell) => ws.write(getCellContent(cell) + ';'))
      }
      ws.write('\n')
    })
    ws.write('')
    console.log(chalk.green('CSV file written :') + filePath)
  })
}

function getDocumentSheets (ods) {
  let body = ods['office:document-content']['office:body'][0]
  let sheets = body['office:spreadsheet'][0]['table:table']
  return sheets
}

function getSheetRows (sheet) {
  return sheet['table:table-row']
}

function getRowCells (row) {
  return row['table:table-cell']
}

function getCellContent (cell) {
  let content = (cell) ? cell['text:p'] || '' : ''
  return String(content)
}

function compareRows (row1, row2) {
  let cells1 = getRowCells(row1)
  let cells2 = getRowCells(row2)
}

function setAddedStyleToRow (row) {
  let cells = getRowCells(row)
  cells.forEach((cell, cellIndex) => {
    if (!cell) {
      cells[cellIndex] = createEmptyCell()
      cell = cells[cellIndex]
    }
    setAddedStyle(cell)
  })
}

function setRemovedStyleToRow (row) {
  row['table:table-cell'].forEach((cell, cellIndex) => {
    if (!cell) {
      row['table:table-cell'][cellIndex] = createEmptyCell()
      cell = row['table:table-cell'][cellIndex]
    }
    setRemovedStyle(cell)
  })
}

function setAddedStyle (cell) {
  cell.$['table:style-name'] = CELL_STYLE_ADDED_LINE
}

function setRemovedStyle (cell) {
  cell.$['table:style-name'] = CELL_STYLE_REMOVED_LINE
}

function createEmptyCell () {
  return {
    $: {},
    'text:p': [' ']
  }
}

function setDiffStyles (ods) {
  let styles = ods['office:document-content']['office:automatic-styles'][0]
  let addedLineStyle = createCellStyleBgColor(CELL_STYLE_ADDED_LINE, CELL_STYLE_ADDED_LINE_COLOR)
  let removedLineStyle = createCellStyleBgColor(CELL_STYLE_REMOVED_LINE, CELL_STYLE_REMOVED_LINE_COLOR)

  styles['style:style'].push(addedLineStyle)
  styles['style:style'].push(removedLineStyle)
  // console.dir({styles}, {depth: 5, colors: true})
}

function createCellStyleBgColor (styleName, color) {
  return {
    '$': {'style:name': styleName, 'style:family': 'table-cell'},
    'style:table-cell-properties': [ { '$': { 'fo:background-color': color } } ]
  }
}

function parseFile (filePath) {
  const parser = new xml2js.Parser()

  console.log('\n' + chalk.blue('Parse xml file: ') + filePath + '...')

  return new Promise((resolve, reject) => {
    fs.readFile(filePath, (err, data) => {
      if (err) {
        reject(err)
        return
      }

      parser.parseString(data, (err, xml) => {
        if (err) {
          reject(err)
          return
        }

        console.log('> ' + chalk.green('PARSED') + ': ' + filePath)
        resolve(xml)
      })
    })
  })
}
