// SPDX-License-Identifier: GPL-3.0
pragma solidity >=0.4.0 <0.9.0;

contract SimpleStorage {
    mapping(address => uint) vediamo;
    //mapping(string => uint) vediamo2;


    function initializeThreshold() public {
        vediamo[msg.sender] = 12;
        // vediamo2["ciao"] = 12;

    }
    /*function funzione2() public {
       vediamo[msg.sender] = 12;
       vediamo2["ciao"] = 12;

   }*/
}
