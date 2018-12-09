const qualifierRe = /(?:\.\&\w+)?[\w\s]*\([^()]*(?:\([^)]*\))*\)|DEFAULT[\w\s]+/;
const postQualifierRe = /(?:\.\&\w+)?\([^()]*(?:\([^)]*\))*\)/;


const opCodes = {};
let capArgs = null;
let paramsMap = {};

function mixin(target, source) {
  for (var p in source) {
    if (source[p] !== undefined) {
      target[p] = source[p];
    }
  }

  return target;
}

function getBlockContents(s, startIdx) {
  let nesting = 0;
  let idx = startIdx;
  let ch = null;

  while (true) {
    ch = s[idx];

    switch (ch) {
    case '{':
      nesting++;
      break;

    case '}':
      if (!nesting) {
        throw new Error('Unmatched }');
      }

      if (nesting === 1) {
        return s.substring(startIdx + 1, idx);
      }

      nesting--;

      break;
    }

    idx++;

    if (idx === s.length) {
      throw new Error('Block not found');
    }
  }
}

function parseSequence(s) {
  const elements = [];

  let idx = 0;
  let match = null;
  let name = null;
  let element = null;

  while (true) {
    match = /^(\.{3}|[\w-]+\b)\s?/.exec(s.slice(idx));

    if (!match) {
      throw new Error('Identifier not found');
    }

    name = match[1];

    idx += match[0].length;

    if (name !== '...') {
      element = parseElement(s.slice(idx));

      idx += element.length;
      delete element.length;

      let qualifiers = undefined;
      let optional = undefined;

      const qualifierRe = new RegExp(
        /^(QUALIFIER)?\s?/
          .source
          .replace('QUALIFIER', postQualifierRe.source)
      );

      match = qualifierRe.exec(s.slice(idx));

      if (match) {
        qualifiers = match[1];
        idx += match[0].length;
      }

      if (/^OPTIONAL/.test(s.slice(idx))) {
        optional = true;
        idx += 'OPTIONAL'.length;
      }

      elements.push(mixin(element, {
        name,
        qualifiers,
        optional
      }));
    }

    if (s[idx] !== ',') {
      break;
    }

    idx++;
  }

  return elements;
}

function parseBitString(s) {
  return s
    .split(',')
    .filter((s) => s !== '...')
    .map((s) => {
      const match = /^([\w-]+)\((\d+)\)/.exec(s);

      if (!match) {
        throw new Error('Could not parse bit string value');
      }

      return {
        name: match[1],
        value: parseInt(match[2], 10)
      };
    });
}

function parseElement(s) {
  const types = [
    'OCTET STRING',
    'INTEGER',
    'NULL',
    'BOOLEAN',
    'NumericString',
    'SEQUENCE',
    'SET',
    'CHOICE',
    'BIT STRING',
    'ENUMERATED',
    'MAP-EXTENSION',
    'OBJECT IDENTIFIER',
    'IA5String',
    'EXTENSION'
  ];

  if (/^TRUE\b/.test(s)) {
    return {
      type: 'BOOLEAN',
      value: true,
      length: 'TRUE'.length
    };
  } else if (/^FALSE\b/.test(s)) {
    return {
      type: 'BOOLEAN',
      value: false,
      length: 'FALSE'.length
    };
  }

  const typeRe = new RegExp(
    /^(?:\[(\d+)\])?(?:(IMPLICIT)\s)?(TYPE)\s?(QUALIFIER)?(?:\b(OF\s))?/
      .source
      .replace('TYPE', types.join('|'))
      .replace('QUALIFIER', qualifierRe.source),
    'g'
  );

  let tag = null;
  let implicit = null;
  let type = null;
  let qualifiers = null;
  let ctorOf = null;
  let element = null;
  let length = 0;

  const match = typeRe.exec(s);

  if (match) {
    tag = match[1] && parseInt(match[1], 10);
    implicit = match[2] && true;
    type = match[3];
    qualifiers = match[4];
    ctorOf = !!match[5];
    length = match[0].length;

    element = {
      name: undefined, // to hold first position in output
      tag,
      implicit,
      type,
      qualifiers,
      length
    };

    if (ctorOf) {
      const el = parseElement(s.slice(typeRe.lastIndex));
      element.ofElement = el;
      element.length += el.length;
      delete el.length;
    } else {
      let block = null;

      switch (type) {
        case 'CHOICE':
        case 'SEQUENCE':
        case 'SET':
          block = getBlockContents(s, typeRe.lastIndex);
          element.length += block.length + 2;

          if (block !== '...') {
            element.elements = parseSequence(block);
          } else {
            element.elements = [];
          }
          break;

        case 'BIT STRING':
        case 'ENUMERATED':
          if (s[typeRe.lastIndex] === '{') {
            block = getBlockContents(s, typeRe.lastIndex);
            element.length += block.length + 2;
            element.values = parseBitString(block);
          }
          break;
        case 'OCTET STRING':
          if (!/^\(?SIZE\b/.test(element.qualifiers)) {
            element.qualifiers = null;
            element.length = 'OCTET STRING'.length;
          }
          break;
        default:
          break;
      }
    }

    element.qualifiers = resolveQualifier(element.qualifiers);

    return element;
  } else {
    return parseSubtype(s);
  }
}

function parseSubtype(s) {
  const argumentRe = /^(?:\[(\d+)\])?([\w-]+)\s?((?:DEFAULT\s?(?:{?[\w'\s]+}?))|(?:{[^{}]*(?:{[\w]+})*}))?\s?/g;
  let matchArg = null;

  if (matchArg = argumentRe.exec(s)) {
    const arg = findArg(matchArg[2]);

    if (arg) {
      const elem = parseElement(arg);
      elem.tag = matchArg[1] && parseInt(matchArg[1], 10);

      if (matchArg[3] && matchArg[3] !== '{bound}') {
        elem.qualifiers = resolveQualifier(matchArg[3]);
      }

      elem.length = argumentRe.lastIndex;

      return elem;
    }
  }

  throw new Error('Could not find Subtype');
}

function createMapOfBlock(block) {
  let idx = 0;
  let match = null;
  let elements = {};

  while (true) {
    match = /(&?[\w-]+)\s?(\d+|INTEGER|(?:&[\w-]+))/.exec(block.slice(idx));

    if (!match) {
      throw new Error('Block identifier not found');
    }

    elements[match[1]] = match[2];
    idx += match[0].length;

    if (!block[idx]) {
      break;
    }

    idx++;
  }

  return elements;
}

function parseParametersBound(asn) {
  const paramsRe = /\b(PARAMETERS-BOUND::=CLASS)/g;
  const paramsWithSyntaxRe = /\bWITH SYNTAX/g;
  const capSpecBoundSetRe = /\bcAPSpecificBoundSet PARAMETERS-BOUND::=/g;
  const paramsBoundMatch = paramsRe.exec(asn);

  if (paramsBoundMatch) {
    let idx = paramsRe.lastIndex;
    const blockParamsBound = getBlockContents(asn, idx);
    idx += blockParamsBound.length + 2;
    const paramsSyntaxMatch = paramsWithSyntaxRe.exec(asn.slice(idx));

    if (paramsSyntaxMatch) {
      idx += paramsWithSyntaxRe.lastIndex;
      const blockParamsSyntax = getBlockContents(asn, idx);
      idx += blockParamsSyntax.length + 2;
      const capSpecBoundSetMatch = capSpecBoundSetRe.exec(asn.slice(idx));

      if (capSpecBoundSetMatch) {
        idx += capSpecBoundSetRe.lastIndex;
        const capSpecMap = createMapOfBlock(getBlockContents(asn, idx));
        const withSyntaxMap = createMapOfBlock(blockParamsSyntax);
        const paramsBoundMap = createMapOfBlock(blockParamsBound);

        Object.keys(withSyntaxMap).forEach((key) => {
          paramsBoundMap[withSyntaxMap[key]] = capSpecMap[key];
        });

        return paramsBoundMap;
      }
    }
  } else {
    throw new Error('No PAARAMETERS-BOUND found.');
  }
}

function resolveQualifier(qualifier) {
  let refinedQualifier = qualifier;
  if (!refinedQualifier) {
    return refinedQualifier;
  }

  const boundRe = /\b(?:\(|\.\.)(?:bound\.)?([a-zA-Z&]+)/;
  let match = null;

  while (match = boundRe.exec(refinedQualifier)) {
    if (paramsMap[match[1]]) {
      refinedQualifier = refinedQualifier.replace(`bound.${match[1]}`, paramsMap[match[1]]);
    } else {
      const constVarRe = new RegExp(
        /\b(?:VAR\sINTEGER)::=([\d]+)/
          .source
          .replace('VAR', match[1])
      );

      const varMatch = constVarRe.exec(capArgs);
      refinedQualifier = refinedQualifier.replace(match[1], varMatch[1]);
    }
  }

  return refinedQualifier;
}

function findArg(argName) {
  const argRe = new RegExp(
    /(?:[^-])\b(ARG)(?:{[\w-:]*})?::=/
      .source
      .replace('ARG', argName),
      'g'
  );
  let match = null;

  if (match = argRe.exec(capArgs)) {
    return capArgs.slice(argRe.lastIndex);
  }
}

function parseOpCode(s) {
  const codeRe = /(opcode-[\w]+) Code::=local:(\d+)/g;
  let match = null;

  while (match = codeRe.exec(s)) {
    const opName = match[1];

    if (match[2]) {
      opCodes[opName] = parseInt(match[2], 10);
    }
  }
}

function parseOpBody(s) {
  const argumentRe = /ARGUMENT\s?/g;
  const returnResultRe = /RETURN RESULT\s?/g;
  const resultRe = /RESULT\s?/g;
  const codeRe = /CODE\s?/g;

  let argument = null;
  let result = null;
  let code = null;

  if (argumentRe.exec(s)) {
    argument = parseElement(s.slice(argumentRe.lastIndex));
    delete argument.length;
  }

  if (returnResultRe.exec(s)) {
    result = parseElement(s.slice(returnResultRe.lastIndex));
    delete result.length;
  } else if (resultRe.exec(s)) {
    result = parseElement(s.slice(resultRe.lastIndex));
    delete result.length;
  }

  if (codeRe.exec(s)) {
    const match = /(^opcode-[\w]+)/.exec(s.slice(codeRe.lastIndex));

    if (match) {
      code = opCodes[match[1]];
    } else {
      throw new Error('Could not parse code');
    }
  }

  return {
    argument,
    result,
    code
  };
}

function parseErrorBody(s) {
  const parameterRe = /PARAMETER\s?/g;
  const codeRe = /CODE\s?/g;

  let parameter = null;
  let result = null;
  let code = null;

  if (parameterRe.exec(s)) {
    parameter = parseElement(s.slice(parameterRe.lastIndex));
    delete parameter.length;
  }

  if (codeRe.exec(s)) {
    const match = /^local:(\d+)/.exec(s.slice(codeRe.lastIndex));

    if (match) {
      code = parseInt(match[1], 10);
    } else {
      throw new Error('Could not parse code');
    }
  }

  return {
    parameter,
    code
  };
}

function parse(s, args) {
  s = s
    .split('\n') // Split into row
    .filter((row) => !/^--/.test(row)) // Filter out comment rows
    .join(''); // Join rows

  s = s
    .replace(/\s+/g, ' ') // Replace sequental whitespace with a single space
    .replace(/\B \b|\b \B|\B \B/g, ''); // Replace all space except between words

  args = args
    .split('\n') // Split into row
    .filter((row) => !/--/.test(row)) // Filter out comment rows
    .join(' '); // Join rows

  capArgs = args
    .replace(/\s+/g, ' ') // Replace sequental whitespace with a single space
    .replace(/\B \b|\b \B|\B \B/g, ''); // Replace all space except between words

  // return capArgs;
  parseOpCode(s);
  paramsMap = parseParametersBound(capArgs);

  const opRe = /\b([\w-]+)\s?(?:{[\w-:]+})\s?(OPERATION)::=/g;
  let match = null;

  const blocks = {};

  while (match = opRe.exec(s)) {
    const operationCodeName = match[1];
    let block = null;

    if (match[2] === 'OPERATION') {
      block = parseOpBody(getBlockContents(s, opRe.lastIndex));
    } else if (match[2] === 'ERROR') {
      block = parseErrorBody(getBlockContents(s, opRe.lastIndex));
    }

    blocks[operationCodeName] = block;
  }

  return { blocks };
}

module.exports = Object.freeze({
  parse
});
