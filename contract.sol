pragma solidity >=0.4.0 <0.9.0;

contract SimpleStorage {
    mapping(uint => string) vediamo;
    mapping(string => string) vediamo2;


    function initializeThreshold(uint256 x) public {
        vediamo[31] = "777";
        vediamo2["ciao"] = "777";
    }
}