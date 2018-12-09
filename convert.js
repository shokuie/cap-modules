const fs = require('fs');

const parseArgs = require('minimist');
const asn1expCamelEx = require('./asn1expCamelEx');

let dataTypes = null;

const walk = (dir, ext, done) => {
  fs.readdir(dir, (error, list) => {
    if (error) {
      return done(error);
    }

    let i = 0;

    (function next() {
      let file = list[i++];

      if (!file) {
        return done(null);
      } else if (!file.endsWith(ext)) {
        return next();
      }

      file = `${dir}/${file}`;

      fs.stat(file, (error, stat) => {
        if (stat && stat.isDirectory()) {
          next();
        } else {
          const fileRead = Promise.resolve(fs.readFileSync(file, 'UTF-8'));

          fileRead
            .then((asnFile) => {
              dataTypes += asnFile;
              next();
            });
        }
      });
    }());
  });
};

function parse(fileName) {
  return new Promise((resolve, reject) => {
    const fileRead = Promise.resolve(fs.readFileSync(fileName, 'UTF-8'));

    fileRead
      .then((camelAsn) => {
          walk('exp/', 'asn', (error) => {
            if (error) {
              reject(error);
            } else {
              resolve(asn1expCamelEx.parse(camelAsn, camelAsn + dataTypes));
            }
          });
        });
    });
}

function parseErrorTypes() {
  const fileName = 'error-exp/CAP-Errortypes.asn';
  const fileRead = Promise.resolve(fs.readFileSync(fileName, 'UTF-8'));
  const fileWrite = arg => Promise.resolve(fs.writeFileSync(`${fileName}.json`, arg));

  fileRead
    .then((camelAsn) => {
      walk('error-exp/', 'asn', (error) => {
        if (error) {
          throw error;
        } else {
          const parsed = asn1exp.parse(camelAsn, camelAsn + dataTypes);

          fileWrite(JSON.stringify(parsed.blocks, null, 2));
        }
      });
    })
    .catch((error) => {
      console.error(error);
      process.exit(1);
    });
}

const argv = parseArgs(process.argv.slice(2), {
    boolean: 'min'
  });
  
parse(process.argv[2])
  .then((parsed) => {
    argv.min ? console.log(JSON.stringify(parsed.blocks)) : console.log(JSON.stringify(parsed.blocks, null, 2));
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
