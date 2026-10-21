// why: Safari sends the Enter or Escape that ends an IME composition after compositionend, with isComposing false and keyCode 229.
export function composing(event) {
  return event.isComposing || event.keyCode === 229;
}
