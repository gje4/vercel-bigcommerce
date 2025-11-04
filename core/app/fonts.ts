import { Nunito, Nunito_Sans, Roboto_Mono } from 'next/font/google';

export const nunito = Nunito({
  display: 'swap',
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-family-nunito',
});

export const nunitoSans = Nunito_Sans({
  display: 'swap',
  subsets: ['latin'],
  weight: ['400', '600', '700', '800'],
  variable: '--font-family-nunito-sans',
});

export const robotoMono = Roboto_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-family-roboto-mono',
});

export const fonts = [nunito, nunitoSans, robotoMono];
