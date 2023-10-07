// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.4.0 <0.9.0;

contract SimpleStorage {
    uint storedData;
    bool valoreboo;


    function initializeThreshold(uint inp1, bool inp2) public {
        storedData = inp1;
        valoreboo = inp2;
    }
}