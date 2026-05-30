'use client';

import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { JMFEscrow_CONTRACT_ADDRESS, JMFEscrow_CONTRACT_ABI } from '@/config/web3Config';
import { JSAVIOR_CONTRACT_ADDRESS, JSAVIOR_CONTRACT_ABI } from '@/config/web3Config';
import { GOLD4X_CONTRACT_ADDRESS, GOLD4X_CONTRACT_ABI } from '@/config/web3Config';
import { USDT_CONTRACT_ADDRESS, USDT_CONTRACT_ABI } from '@/config/web3Config';
import { ethers } from 'ethers';

interface Order {
  id: number;
  token: 'JSAV' | 'G4X' | 'USDT';
  type: 'buy' | 'sell';
  amount: number;
  price: number;
  user: string;
  status: 'open' | 'in progress' | 'payment sent' | 'completed' | 'cancelled';
}

const initialOrders: Order[] = [];

interface ChatMessage {
  sender: string;
  text: string;
  time: string;
}

const SOCKET_URL = 'http://localhost:4000'; // Change if backend runs elsewhere
const FIXED_INR_PRICES = {
  JSAV: 100,
  G4X: 91,
  USDT: 92,
} as const;

const P2PPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>(initialOrders);
  const [form, setForm] = useState({ token: 'JSAV' as 'JSAV' | 'G4X' | 'USDT', type: 'buy' as 'buy' | 'sell', amount: '' });
  const [chatOpen, setChatOpen] = useState<number | null>(null);
  const [chatMessages, setChatMessages] = useState<Record<number, ChatMessage[]>>({});
  const [chatInput, setChatInput] = useState('');
  const [fileList, setFileList] = useState<Record<number, File[]>>({});
  const [socket, setSocket] = useState<Socket | null>(null);
  const [escrowId, setEscrowId] = useState<number | null>(null);
  const [escrowToken, setEscrowToken] = useState<'JSAV' | 'G4X' | 'USDT'>('JSAV');
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (form.token !== 'JSAV' && form.type !== 'sell') {
      setForm((prev) => ({ ...prev, type: 'sell' }));
    }
  }, [form.token, form.type]);

  useEffect(() => {
    const s = io(SOCKET_URL);
    setSocket(s);
    return () => { s.disconnect(); };
  }, []);

  useEffect(() => {
    if (!socket || chatOpen === null) return;
    socket.emit('joinOrder', chatOpen);
    socket.on('chatHistory', (msgs) => {
      setChatMessages(msgsObj => ({ ...msgsObj, [chatOpen]: msgs }));
    });
    socket.on('chatMessage', (msg) => {
      setChatMessages(msgsObj => ({
        ...msgsObj,
        [chatOpen]: [...(msgsObj[chatOpen] || []), msg],
      }));
    });
    return () => {
      socket.off('chatHistory');
      socket.off('chatMessage');
    };
  }, [socket, chatOpen]);

  useEffect(() => {
    if (chatEndRef.current) chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages, chatOpen]);

  const handleCreateOrder = (e: React.FormEvent) => {
    e.preventDefault();
    const newOrder: Order = {
      id: orders.length + 1,
      token: form.token,
      type: form.type,
      amount: Number(form.amount),
      price: FIXED_INR_PRICES[form.token],
      user: 'You',
      status: 'open',
    };
    setOrders([newOrder, ...orders]);
    setForm((prev) => ({ ...prev, amount: '' }));
  };

  const updateOrderStatus = (orderId: number, status: Order['status']) => {
    setOrders(orders => orders.map(o => o.id === orderId ? { ...o, status } : o));
  };

  const handleSendMessage = (orderId: number) => {
    if (!chatInput.trim() || !socket) return;
    socket.emit('chatMessage', { orderId, sender: 'You', text: chatInput });
    setChatInput('');
  };

  const handleFileUpload = async (orderId: number, files: FileList | null) => {
    if (!files) return;
    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));
    const res = await fetch(`${SOCKET_URL}/upload/${orderId}`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    setFileList(list => ({
      ...list,
      [orderId]: [...(list[orderId] || []), ...data.files],
    }));
  };

  // Escrow integration
  const handleCreateEscrow = async (order?: Order) => {
    if (!order) return alert('Order not found.');
    if (!JMFEscrow_CONTRACT_ADDRESS) return alert('Escrow contract is not configured yet.');
    if (!(window as any).ethereum) return alert('Wallet not found');
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const signer = await provider.getSigner();
    const escrow = new ethers.Contract(JMFEscrow_CONTRACT_ADDRESS, JMFEscrow_CONTRACT_ABI, signer);
    const tx = await escrow.createEscrow(order.user, ethers.parseUnits(order.amount.toString(), 18));
    const receipt = await tx.wait();
    // Get escrowId from event or increment
    setEscrowId(receipt.logs[0]?.args?.escrowId ?? null);
    setEscrowToken(order.token);
    alert('Escrow created!');
  };

  const handleFundEscrow = async () => {
    if (!JMFEscrow_CONTRACT_ADDRESS) return alert('Escrow contract is not configured yet.');
    if (!(window as any).ethereum || escrowId === null) return alert('No escrow');
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const signer = await provider.getSigner();
    const tokenAddress = escrowToken === 'G4X'
      ? GOLD4X_CONTRACT_ADDRESS
      : escrowToken === 'USDT'
        ? USDT_CONTRACT_ADDRESS
        : JSAVIOR_CONTRACT_ADDRESS;
    const tokenAbi = escrowToken === 'G4X'
      ? GOLD4X_CONTRACT_ABI
      : escrowToken === 'USDT'
        ? USDT_CONTRACT_ABI
        : JSAVIOR_CONTRACT_ABI;
    const token = new ethers.Contract(tokenAddress, tokenAbi, signer);
    // Approve escrow contract
    await token.approve(JMFEscrow_CONTRACT_ADDRESS, ethers.parseUnits('100', 18)); // Replace 100 with actual amount
    const escrow = new ethers.Contract(JMFEscrow_CONTRACT_ADDRESS, JMFEscrow_CONTRACT_ABI, signer);
    const tx = await escrow.fundEscrow(escrowId);
    await tx.wait();
    alert(`${escrowToken} locked in escrow!`);
  };

  const handleReleaseEscrow = async () => {
    if (!JMFEscrow_CONTRACT_ADDRESS) return alert('Escrow contract is not configured yet.');
    if (!(window as any).ethereum || escrowId === null) return alert('No escrow');
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const signer = await provider.getSigner();
    const escrow = new ethers.Contract(JMFEscrow_CONTRACT_ADDRESS, JMFEscrow_CONTRACT_ABI, signer);
    const tx = await escrow.release(escrowId);
    await tx.wait();
    alert(`${escrowToken} released to buyer!`);
  };

  const handleRefundEscrow = async () => {
    if (!JMFEscrow_CONTRACT_ADDRESS) return alert('Escrow contract is not configured yet.');
    if (!(window as any).ethereum || escrowId === null) return alert('No escrow');
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const signer = await provider.getSigner();
    const escrow = new ethers.Contract(JMFEscrow_CONTRACT_ADDRESS, JMFEscrow_CONTRACT_ABI, signer);
    const tx = await escrow.refund(escrowId);
    await tx.wait();
    alert(`${escrowToken} refunded to seller!`);
  };

  return (
    <div className="fx-shell">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="fx-card p-6 sm:p-8 fx-reveal">
          <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="flex items-center gap-3 mb-3">
                <span className="fx-pill">P2P Desk</span>
                <span className="fx-pill fx-pill--ghost">JSAV, G4X & USDT / INR</span>
              </div>
              <h1 className="fx-section-title text-3xl">P2P Trading</h1>
              <p className="text-sm text-[#b9b0a3] max-w-2xl">
                Match buy and sell orders for JSAV in INR, and sell-only orders for G4X and USDT in INR. Use the secured chat and escrow
                workflow to coordinate settlement.
              </p>
            </div>
            <a className="fx-button fx-button--ghost" href="/">
              Back to Dashboard
            </a>
          </div>
        </div>

        <section className="grid grid-cols-1 md:grid-cols-3 gap-4 fx-reveal fx-reveal--delay-1">
          <div className="fx-card fx-card--lift p-5">
            <div className="fx-kicker mb-3">Liquidity</div>
            <h3 className="fx-section-title text-lg mb-2">Active Orders</h3>
            <p className="text-sm text-[#b9b0a3]">Monitor current buy/sell demand with instant matches.</p>
          </div>
          <div className="fx-card fx-card--lift p-5">
            <div className="fx-kicker mb-3">Security</div>
            <h3 className="fx-section-title text-lg mb-2">Escrow Ready</h3>
            <p className="text-sm text-[#b9b0a3]">Lock JSAV, G4X, or USDT securely before you release settlement.</p>
          </div>
          <div className="fx-card fx-card--lift p-5">
            <div className="fx-kicker mb-3">Speed</div>
            <h3 className="fx-section-title text-lg mb-2">Fast Settlement</h3>
            <p className="text-sm text-[#b9b0a3]">Coordinate payment and release within a single flow.</p>
          </div>
        </section>

        <div className="fx-card p-6 fx-reveal fx-reveal--delay-2">
            <p className="font-semibold text-[#f3d68a] mb-2">P2P trading for JSAV/INR, G4X/INR and USDT/INR</p>
          <p className="text-sm text-[#b9b0a3]">
            Users can buy or sell JSAV in INR at a fixed rate, and users can sell G4X or USDT in INR at fixed rates. Chat and share documents with your counterparty after matching.
          </p>
          <p className="text-sm text-[#f3d68a] mt-2">Fixed rate: 1 JSAV = {FIXED_INR_PRICES.JSAV} INR</p>
          <p className="text-sm text-[#f3d68a]">Fixed rate: 1 G4X = {FIXED_INR_PRICES.G4X} INR</p>
          <p className="text-sm text-[#f3d68a]">Fixed rate: 1 USDT = {FIXED_INR_PRICES.USDT} INR</p>
        </div>

        <form onSubmit={handleCreateOrder} className="fx-card p-6 grid gap-4 md:grid-cols-[1fr_1fr_1fr_auto] items-end fx-reveal fx-reveal--delay-2">
          <div>
            <label className="block text-xs uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">Token</label>
            <select
              value={form.token}
              onChange={e => setForm(f => ({ ...f, token: e.target.value as 'JSAV' | 'G4X' | 'USDT' }))}
              className="fx-input"
            >
              <option value="JSAV">JSAV</option>
              <option value="G4X">G4X</option>
              <option value="USDT">USDT</option>
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">Type</label>
            <select
              value={form.type}
              onChange={e => setForm(f => ({ ...f, type: e.target.value as 'buy' | 'sell' }))}
              className="fx-input"
              disabled={form.token !== 'JSAV'}
            >
              {form.token === 'JSAV' && <option value="buy">Buy</option>}
              <option value="sell">Sell</option>
            </select>
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">Amount ({form.token})</label>
            <input
              type="number"
              min="1"
              required
              placeholder={`Amount (${form.token})`}
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              className="fx-input"
            />
          </div>
          <div>
            <label className="block text-xs uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">Fixed Price (INR)</label>
            <div className="fx-input flex items-center">{FIXED_INR_PRICES[form.token]}</div>
          </div>
          <button type="submit" className="fx-button">Post Order</button>
        </form>

        <div className="fx-card p-6 fx-reveal fx-reveal--delay-3">
          <h2 className="fx-section-title text-xl mb-4">Order Book</h2>
          <div className="overflow-x-auto">
            <table className="fx-table text-sm">
              <thead>
                <tr>
                  <th>Token</th>
                  <th>Type</th>
                  <th>Amount</th>
                  <th>Price (INR)</th>
                  <th>User</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 && (
                  <tr>
                    <td className="text-center text-[#b9b0a3] py-6" colSpan={7}>
                      No previous orders. Post the first JSAV, G4X, or USDT order to go live.
                    </td>
                  </tr>
                )}
                {orders.map(order => (
                  <tr key={order.id} className={order.type === 'buy' ? 'bg-[rgba(56,183,161,0.08)]' : 'bg-[rgba(216,76,76,0.08)]'}>
                    <td className="font-semibold text-center">{order.token}</td>
                    <td className="font-semibold text-center">{order.type.toUpperCase()}</td>
                    <td className="text-center">{order.amount}</td>
                    <td className="text-center">{order.price}</td>
                    <td className="text-center">{order.user}</td>
                    <td className="text-center">
                      <span className={
                        order.status === 'completed' ? 'text-[#8fe3d4] font-bold' :
                        order.status === 'cancelled' ? 'text-[#b9b0a3] line-through' :
                        order.status === 'payment sent' ? 'text-[#f3d68a] font-semibold' :
                        order.status === 'in progress' ? 'text-[#f5dd9f] font-semibold' :
                        ''
                      }>
                        {order.status}
                      </span>
                    </td>
                    <td className="text-center">
                      <button
                        className={order.type === 'buy' ? 'fx-button' : 'fx-button fx-button--dark'}
                        onClick={() => {
                          setChatOpen(order.id);
                          setTimeout(() => {
                            setChatInput(
                              order.type === 'buy'
                                ? `I want to sell ${order.amount} ${order.token} at ${order.price} INR`
                                : `I want to buy ${order.amount} ${order.token} at ${order.price} INR`
                            );
                          }, 100);
                        }}
                      >
                        {order.type === 'buy' ? 'Sell' : 'Buy'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      {/* Chat & Docs Modal */}
      {chatOpen !== null && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4">
          <div className="fx-card w-full max-w-md p-6 relative">
            <button className="absolute top-3 right-3 text-[#b9b0a3] hover:text-[#f6f0e6]" onClick={() => setChatOpen(null)}>&times;</button>
            <h3 className="fx-section-title text-lg mb-2">Chat & Docs (Order #{chatOpen})</h3>
            <div className="mb-2 text-sm text-[#b9b0a3]">
              <span className="font-semibold text-[#f6f0e6]">Order Status: </span>
              <span>{orders.find(o => o.id === chatOpen)?.status}</span>
            </div>
            <div className="border border-[rgba(255,255,255,0.08)] rounded p-3 h-40 mb-3 overflow-y-auto bg-[rgba(15,20,34,0.85)] text-sm">
              {(chatMessages[chatOpen] || []).map((msg, i) => (
                <div key={i} className="mb-1">
                  <span className="font-semibold text-[#f3d68a]">{msg.sender}:</span> <span>{msg.text}</span>
                  <span className="text-xs text-[#b9b0a3] ml-2">{msg.time}</span>
                </div>
              ))}
              <div ref={chatEndRef} />
            </div>
            <div className="flex gap-2 mb-3">
              <input
                className="fx-input flex-1"
                placeholder="Type a message..."
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') handleSendMessage(chatOpen); }}
              />
              <button className="fx-button" onClick={() => handleSendMessage(chatOpen)}>Send</button>
            </div>
            <div className="mb-3">
              <label className="block text-xs uppercase tracking-[0.2em] text-[#b9b0a3] mb-1">Upload Document</label>
              <input className="text-sm text-[#b9b0a3]" type="file" multiple onChange={e => handleFileUpload(chatOpen, e.target.files)} />
              <div className="mt-2 text-xs text-[#b9b0a3]">
                {(fileList[chatOpen] || []).map((file: any, i) => (
                  <div key={i}>
                    {file.url ? (
                      <a href={`${SOCKET_URL}${file.url}`} target="_blank" rel="noopener noreferrer" className="text-[#f3d68a] underline">{file.originalname || file.name}</a>
                    ) : (
                      file.name
                    )}
                  </div>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap gap-2 mb-2">
              <button className="fx-button fx-button--dark" onClick={() => updateOrderStatus(chatOpen, 'in progress')}>Mark In Progress</button>
              <button className="fx-button" onClick={() => updateOrderStatus(chatOpen, 'payment sent')}>Payment Sent</button>
              <button className="fx-button" onClick={() => updateOrderStatus(chatOpen, 'completed')}>Release {orders.find(o => o.id === chatOpen)?.token || 'Token'}</button>
              <button className="fx-button fx-button--ghost" onClick={() => updateOrderStatus(chatOpen, 'cancelled')}>Cancel</button>
              <button className="fx-button fx-button--dark" onClick={() => handleCreateEscrow(orders.find(o => o.id === chatOpen))}>Create Escrow</button>
              <button className="fx-button fx-button--dark" onClick={handleFundEscrow}>Lock {orders.find(o => o.id === chatOpen)?.token || 'Token'}</button>
              <button className="fx-button" onClick={handleReleaseEscrow}>Release to Buyer</button>
              <button className="fx-button fx-button--ghost" onClick={handleRefundEscrow}>Refund to Seller</button>
            </div>
          </div>
        </div>
      )}
      {/* TODO: Implement chat/file backend for persistence and real-time updates */}
      </div>
    </div>
  );
};

export default P2PPage;
