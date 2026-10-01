/** Conservative phrase match used when the crisis classifier is unavailable. */
export function keywordClassifier(keywords: string[]) {
  const needles = keywords.map((k) => k.toLowerCase());
  return (input: string): { flag: boolean; category: "self_harm" | "none" } => {
    const hay = input.toLowerCase();
    const flag = needles.some((n) => hay.includes(n));
    return { flag, category: flag ? "self_harm" : "none" };
  };
}
