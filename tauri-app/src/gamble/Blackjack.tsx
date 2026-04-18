import React, { useState, useCallback } from 'react';
import { GameProps } from './types';
import { gamecornerAsset } from './assets';

/*
  Blackjack – Standard rules:
  - 52-card deck, values: 2-10 face, J/Q/K=10, A=11 (adjusts to 1 if bust)
  - Actions: Hit, Stand, Double, Insurance
  - Payouts: 1:1, 3:2 for natural blackjack
  - Dealer hits on <17, stands on >=17
  Uses facedown card sprite from pokeemerald game corner expansion.
*/

const BJ_SP = gamecornerAsset('blackjack/');

function FaceDownCard() {
  return (
    <span className="bj-facedown" style={{ display: 'inline-block', width: 48, height: 48, overflow: 'hidden', lineHeight: 0 }}>
      <img
        src={`${BJ_SP}facedown.png`}
        alt="?"
        style={{ imageRendering: 'pixelated', width: 48, height: 'auto', display: 'block' }}
      />
    </span>
  );
}

const SUITS = ['♥', '♦', '♣', '♠'] as const;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'] as const;

interface Card { rank: typeof RANKS[number]; suit: typeof SUITS[number]; }

function newDeck(): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ rank: r, suit: s });
  // Shuffle
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

function cardValue(card: Card): number {
  if (card.rank === 'A') return 11;
  if (['K', 'Q', 'J'].includes(card.rank)) return 10;
  return parseInt(card.rank, 10);
}

function handTotal(hand: Card[]): number {
  let total = hand.reduce((s, c) => s + cardValue(c), 0);
  let aces = hand.filter(c => c.rank === 'A').length;
  while (total > 21 && aces > 0) { total -= 10; aces--; }
  return total;
}

function isBlackjack(hand: Card[]): boolean {
  return hand.length === 2 && handTotal(hand) === 21;
}

function cardDisplay(card: Card): string {
  return `${card.rank}${card.suit}`;
}

function isRed(card: Card): boolean {
  return card.suit === '♥' || card.suit === '♦';
}

type Phase = 'betting' | 'playing' | 'dealer' | 'done';

export function Blackjack({ coins, addCoins, spendCoins }: GameProps) {
  const [deck, setDeck] = useState<Card[]>(() => newDeck());
  const [player, setPlayer] = useState<Card[]>([]);
  const [dealer, setDealer] = useState<Card[]>([]);
  const [bet, setBet] = useState(10);
  const [phase, setPhase] = useState<Phase>('betting');
  const [message, setMessage] = useState('Place your bet!');
  const [doubled, setDoubled] = useState(false);
  const [insured, setInsured] = useState(false);
  const [insuranceBet, setInsuranceBet] = useState(0);

  const draw = useCallback((d: Card[]): [Card, Card[]] => {
    if (d.length < 2) d = newDeck(); // reshuffle when low
    return [d[0], d.slice(1)];
  }, []);

  const deal = useCallback(() => {
    if (coins < bet) { setMessage('Not enough coins!'); return; }
    spendCoins(bet);

    let d = deck.length < 10 ? newDeck() : [...deck];
    const [c1, d1] = [d[0], d.slice(1)]; d = d1;
    const [c2, d2] = [d[0], d.slice(1)]; d = d2;
    const [c3, d3] = [d[0], d.slice(1)]; d = d3;
    const [c4, d4] = [d[0], d.slice(1)]; d = d4;

    const pHand = [c1, c3];
    const dHand = [c2, c4];

    setDeck(d);
    setPlayer(pHand);
    setDealer(dHand);
    setDoubled(false);
    setInsured(false);
    setInsuranceBet(0);

    // Check for instant blackjack
    if (isBlackjack(pHand)) {
      if (isBlackjack(dHand)) {
        addCoins(bet); // push
        setMessage('Both Blackjack — Push!');
        setPhase('done');
      } else {
        const win = Math.floor(bet * 2.5); // 3:2 payout
        addCoins(win);
        setMessage(`Blackjack! Won ${win} coins!`);
        setPhase('done');
      }
    } else {
      setPhase('playing');
      setMessage(`Your hand: ${handTotal(pHand)}. Hit, Stand${coins >= bet ? ', or Double' : ''}?`);
    }
  }, [coins, bet, deck, spendCoins, addCoins, draw]);

  const resolveDealerAndPayout = useCallback((pHand: Card[], dHand: Card[], currentDeck: Card[], betAmount: number) => {
    let d = [...currentDeck];
    let dh = [...dHand];

    // Dealer draws
    while (handTotal(dh) < 17) {
      if (d.length === 0) d = newDeck();
      dh.push(d[0]);
      d = d.slice(1);
    }

    setDealer(dh);
    setDeck(d);

    const pt = handTotal(pHand);
    const dt = handTotal(dh);
    const playerBust = pt > 21;
    const dealerBust = dt > 21;

    let msg = '';
    if (playerBust) {
      msg = `Bust! You lose ${betAmount} coins.`;
    } else if (dealerBust) {
      addCoins(betAmount * 2);
      msg = `Dealer busts! Won ${betAmount * 2} coins!`;
    } else if (pt > dt) {
      addCoins(betAmount * 2);
      msg = `You win! ${pt} vs ${dt}. Won ${betAmount * 2} coins!`;
    } else if (pt === dt) {
      addCoins(betAmount);
      msg = `Push — ${pt} vs ${dt}. Bet returned.`;
    } else {
      msg = `Dealer wins. ${pt} vs ${dt}. Lost ${betAmount} coins.`;
    }

    // Insurance payout
    if (insured && isBlackjack(dh)) {
      addCoins(insuranceBet * 3);
      msg += ` Insurance pays ${insuranceBet * 3}!`;
    }

    setMessage(msg);
    setPhase('done');
  }, [addCoins, insured, insuranceBet]);

  const hit = useCallback(() => {
    if (phase !== 'playing') return;
    let d = deck.length === 0 ? newDeck() : [...deck];
    const newPlayer = [...player, d[0]];
    d = d.slice(1);
    setPlayer(newPlayer);
    setDeck(d);

    const total = handTotal(newPlayer);
    if (total > 21) {
      setMessage(`Bust! ${total}. Lost ${doubled ? bet * 2 : bet} coins.`);
      setPhase('done');
    } else if (total === 21) {
      resolveDealerAndPayout(newPlayer, dealer, d, doubled ? bet * 2 : bet);
    } else {
      setMessage(`Your hand: ${total}. Hit or Stand?`);
    }
  }, [phase, deck, player, dealer, bet, doubled, resolveDealerAndPayout]);

  const stand = useCallback(() => {
    if (phase !== 'playing') return;
    resolveDealerAndPayout(player, dealer, deck, doubled ? bet * 2 : bet);
  }, [phase, player, dealer, deck, bet, doubled, resolveDealerAndPayout]);

  const double = useCallback(() => {
    if (phase !== 'playing' || player.length !== 2 || coins < bet) return;
    spendCoins(bet);
    setDoubled(true);

    let d = deck.length === 0 ? newDeck() : [...deck];
    const newPlayer = [...player, d[0]];
    d = d.slice(1);
    setPlayer(newPlayer);
    setDeck(d);

    const total = handTotal(newPlayer);
    if (total > 21) {
      setMessage(`Bust on double! ${total}. Lost ${bet * 2} coins.`);
      setPhase('done');
    } else {
      resolveDealerAndPayout(newPlayer, dealer, d, bet * 2);
    }
  }, [phase, player, dealer, deck, bet, coins, spendCoins, resolveDealerAndPayout]);

  const buyInsurance = useCallback(() => {
    if (phase !== 'playing' || insured) return;
    if (dealer.length < 1 || dealer[0].rank !== 'A') return;
    const iCost = Math.floor(bet / 2);
    if (coins < iCost) return;
    spendCoins(iCost);
    setInsured(true);
    setInsuranceBet(iCost);
    setMessage(`Insurance bought for ${iCost} coins.`);
  }, [phase, insured, dealer, bet, coins, spendCoins]);

  const newGame = useCallback(() => {
    setPhase('betting');
    setPlayer([]);
    setDealer([]);
    setDoubled(false);
    setInsured(false);
    setInsuranceBet(0);
    setMessage('Place your bet!');
  }, []);

  const canInsure = phase === 'playing' && !insured && dealer.length >= 1 && dealer[0].rank === 'A' && coins >= Math.floor(bet / 2);

  return (
    <div className="blackjack">
      <h2>Blackjack</h2>

      {phase === 'betting' && (
        <div className="bj-betting">
          <div className="bj-bet-controls">
            <button className="mini" onClick={() => setBet(b => Math.max(10, b - 10))}>-10</button>
            <span className="bj-bet-amount">{bet}</span>
            <button className="mini" onClick={() => setBet(b => Math.min(coins, b + 10))}>+10</button>
            <button className="mini" onClick={() => setBet(b => Math.min(coins, b + 50))}>+50</button>
          </div>
          <button className="bj-deal-btn" onClick={deal} disabled={coins < bet}>DEAL</button>
        </div>
      )}

      {(phase === 'playing' || phase === 'done') && (
        <>
          <div className="bj-table">
            <div className="bj-hand">
              <div className="bj-hand-label">Dealer {phase === 'done' ? `(${handTotal(dealer)})` : ''}</div>
              <div className="bj-cards">
                {dealer.map((card, i) => (
                  <div key={i} className={`bj-card ${isRed(card) ? 'red' : 'black'} ${i === 1 && phase === 'playing' ? 'face-down' : ''}`}>
                    {i === 1 && phase === 'playing' ? <FaceDownCard /> : cardDisplay(card)}
                  </div>
                ))}
              </div>
            </div>

            <div className="bj-hand">
              <div className="bj-hand-label">You ({handTotal(player)})</div>
              <div className="bj-cards">
                {player.map((card, i) => (
                  <div key={i} className={`bj-card ${isRed(card) ? 'red' : 'black'}`}>
                    {cardDisplay(card)}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className={`bj-message ${phase === 'done' && handTotal(player) <= 21 && (handTotal(player) > handTotal(dealer) || handTotal(dealer) > 21) ? 'win' : ''}`}>
            {message}
          </div>

          {phase === 'playing' && (
            <div className="bj-actions">
              <button onClick={hit}>Hit</button>
              <button onClick={stand}>Stand</button>
              {player.length === 2 && coins >= bet && <button onClick={double}>Double</button>}
              {canInsure && <button onClick={buyInsurance}>Insurance</button>}
            </div>
          )}

          {phase === 'done' && (
            <button className="bj-deal-btn" onClick={newGame}>New Hand</button>
          )}
        </>
      )}
    </div>
  );
}
