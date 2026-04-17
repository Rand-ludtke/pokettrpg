export interface GameProps {
  coins: number;
  addCoins: (n: number) => void;
  spendCoins: (n: number) => boolean;
}
