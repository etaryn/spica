/**
 * The crisis keyword list: a conservative phrase match, used when the classifier is unavailable.
 */

export function keywordClassifier(keywords: string[]) {
  const needles = keywords.map((keyword) => keyword.toLowerCase());

  return (input: string): { flag: boolean; category: "self_harm" | "none" } => {
    const haystack = input.toLowerCase();
    const flag = needles.some((needle) => haystack.includes(needle));
    return { flag, category: flag ? "self_harm" : "none" };
  };
}
