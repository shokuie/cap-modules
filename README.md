# cap-modules
Expanded ASN.1 modules for CAMEL Application Part (CAP) (ETSI TS 129 078) in JSON format

The files are under the dist folder. Just load up the ones you need:

    const operations = require('cap-modules/dist/CAP-Phase4-V2.asn.json');

For CAMEL-*** types like CAMEL-AChBillingChargingCharacteristics you need to load the following file:

    const commonDataTypes = require('cap-modules/dist/CAP-CommonDataTypes.exp.json');
    or
    const commonDataTypes = require('cap-modules/dist/CAP-CommonDataTypesV2.exp.json');
