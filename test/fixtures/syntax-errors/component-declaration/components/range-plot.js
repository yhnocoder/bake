const range = (label) => ({ label, type: 'number', default: 1 });

export const params = { n: range('N') };
export const layout = { height: 300 };

export default function RangePlot() {
  return null;
}
