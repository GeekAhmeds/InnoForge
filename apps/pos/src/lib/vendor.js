// Inno Source contact details shown on the activation screen, in Settings → Support and on receipts.
export const VENDOR = {
  name: 'Inno Source',
  website: 'https://innovationsrc.com',
  websiteLabel: 'innovationsrc.com',
  phones: ['01011600023', '01117330111'],
  // Customer service, printed at the bottom of every receipt and invoice.
  support: '+201011600023',
  // Tutorial videos (uploaded next to the updates).
  videos: 'https://pos.0x01source.com:9990/updates/videos/',
};

// Egyptian mobile numbers → international form for WhatsApp links.
export const whatsappUrl = (phone) => `https://wa.me/2${phone}`;
