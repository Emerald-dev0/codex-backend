import '../styles/globals.css';
import Head from 'next/head';
import Toaster from '../components/Toaster';

export default function AdminApp({ Component, pageProps }) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <link rel="icon" href="/buildrs.png" />
        <title>BuildrsHQ Admin</title>
      </Head>
      <Component {...pageProps} />
      <Toaster />
    </>
  );
}
