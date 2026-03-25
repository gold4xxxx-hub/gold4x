// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface IERC20 {
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract JMFEscrow {
    struct Escrow {
        address seller;
        address buyer;
        uint256 amount;
        bool funded;
        bool released;
        bool refunded;
    }

    IERC20 public jmfToken;
    uint256 public escrowCount;
    mapping(uint256 => Escrow) public escrows;

    event EscrowCreated(uint256 indexed escrowId, address indexed seller, address indexed buyer, uint256 amount);
    event Funded(uint256 indexed escrowId);
    event Released(uint256 indexed escrowId);
    event Refunded(uint256 indexed escrowId);

    constructor(address _jmfToken) {
        jmfToken = IERC20(_jmfToken);
    }

    function createEscrow(address buyer, uint256 amount) external returns (uint256) {
        escrowCount++;
        escrows[escrowCount] = Escrow({
            seller: msg.sender,
            buyer: buyer,
            amount: amount,
            funded: false,
            released: false,
            refunded: false
        });
        emit EscrowCreated(escrowCount, msg.sender, buyer, amount);
        return escrowCount;
    }

    function fundEscrow(uint256 escrowId) external {
        Escrow storage e = escrows[escrowId];
        require(msg.sender == e.seller, "Only seller can fund");
        require(!e.funded, "Already funded");
        require(jmfToken.transferFrom(msg.sender, address(this), e.amount), "Transfer failed");
        e.funded = true;
        emit Funded(escrowId);
    }

    function release(uint256 escrowId) external {
        Escrow storage e = escrows[escrowId];
        require(e.funded, "Not funded");
        require(!e.released, "Already released");
        require(msg.sender == e.seller || msg.sender == e.buyer, "Not authorized");
        e.released = true;
        require(jmfToken.transfer(e.buyer, e.amount), "Release failed");
        emit Released(escrowId);
    }

    function refund(uint256 escrowId) external {
        Escrow storage e = escrows[escrowId];
        require(e.funded, "Not funded");
        require(!e.released, "Already released");
        require(!e.refunded, "Already refunded");
        require(msg.sender == e.seller, "Only seller can refund");
        e.refunded = true;
        require(jmfToken.transfer(e.seller, e.amount), "Refund failed");
        emit Refunded(escrowId);
    }
}
