// Toolbar popup: explains where the extension works. The current tab's URL
// is visible to us only on npmjs.com (content-script host access); elsewhere
// it is undefined and the generic text stays.
const show = (id: string) => {
  for (const el of document.querySelectorAll<HTMLElement>('#elsewhere, #npm, #package')) el.classList.toggle('hidden', el.id !== id);
};

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const url = tabs[0]?.url ?? '';
  if (url.startsWith('https://www.npmjs.com/package/')) show('package');
  else if (url.startsWith('https://www.npmjs.com/')) show('npm');
});

document.getElementById('options')!.addEventListener('click', () => chrome.runtime.openOptionsPage());
document.getElementById('open')!.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://www.npmjs.com/' });
});
