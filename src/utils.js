function stripDiacritics(text) {
  return text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); // remove combining marks
}