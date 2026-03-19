import {
  kopecksToRubles,
  rublesToKopecks,
  toGatewayAmount,
} from './money';

describe('money helpers', () => {
  it('converts rubles to kopecks', () => {
    expect(rublesToKopecks(8490)).toBe(849000);
    expect(rublesToKopecks(0)).toBe(0);
  });

  it('converts kopecks to rubles', () => {
    expect(kopecksToRubles(849000)).toBe(8490);
    expect(kopecksToRubles(0)).toBe(0);
  });

  it('formats gateway amount in kopecks for rubles', () => {
    expect(toGatewayAmount(849000, 'RUB')).toBe('849000');
  });
});

