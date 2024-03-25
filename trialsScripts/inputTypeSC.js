const InputDataDecoder = require('ethereum-input-data-decoder');

const decoder = new InputDataDecoder('./abi.json');

const tx_input = '0x0678be92000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000060000000000000000000000000000000000000000000000000000000000000000b68656c6c6f20776f726c64000000000000000000000000000000000000000000'

const result = decoder.decodeData(tx_input)
console.log(result)

for (let i = 0; i < result.inputs.length; i++) {
    if (Array.isArray(result.inputs[i])) {
        console.log("Array Input result -> ", result.inputs[i])
        console.log("Array Input type -> ", result.types[i])
    } else {
        console.log("Input result -> ", result.inputs[i])
        console.log("Input type -> ", result.types[i])
    }
}