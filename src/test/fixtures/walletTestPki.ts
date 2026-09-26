// MATERIAŁ WYŁĄCZNIE TESTOWY - NIE SĄ TO KLUCZE ANI CERTYFIKATY APPLE/GOOGLE.
//
// Para RSA 2048 i dwa certyfikaty wygenerowane jednorazowo `openssl`-em pod
// testy podpisu przepustek Wallet (`src/lib/events/wallet/__tests__`):
//
//   openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.pem \
//     -days 36500 -subj "/CN=NES Wallet TEST CA - NOT APPLE/O=New European Strategies TEST"
//   openssl req -newkey rsa:2048 -nodes -keyout signer.key -out signer.csr \
//     -subj "/UID=pass.org.example.test/CN=Pass Type ID: pass.org.example.test/OU=TESTTEAM01/O=NES Wallet TEST/C=PL"
//   openssl x509 -req -in signer.csr -CA ca.pem -CAkey ca.key \
//     -set_serial 0x8F1E2D3C4B5A69788796A5B4C3D2E1F0 -days 36500 -sha256 -extfile ext.cnf -out signer.pem
//   openssl rsa -in signer.key -traditional -out signer_pkcs1.key
//   openssl rsa -in signer.key -pubout -out signer_pub.pem
//
// `TEST_WWDR_CERT_PEM` gra rolę pośredniego certyfikatu Apple WWDR, a klucz
// podpisującego - także klucza konta usługi Google w testach JWT. Klucz CA nie
// jest tu potrzebny i nie został zapisany. Numer seryjny ma ustawiony najstarszy
// bit, więc w DER niesie wiodące zero - test sprawdza kopię BAJT W BAJT.
// Nic z tego pliku nie trafia do kodu produkcyjnego (`src/test/**` jest poza
// grafem aplikacji); kluczy nie wolno użyć poza testami.

/** Certyfikat „Pass Type ID" (v3, podpisany przez TEST CA). */
export const TEST_SIGNER_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIID3jCCAsagAwIBAgIRAI8eLTxLWml4h5altMPS4fAwDQYJKoZIhvcNAQELBQAw
UDEnMCUGA1UEAwweTkVTIFdhbGxldCBURVNUIENBIC0gTk9UIEFQUExFMSUwIwYD
VQQKDBxOZXcgRXVyb3BlYW4gU3RyYXRlZ2llcyBURVNUMCAXDTI2MDkyNjE0MzYw
MVoYDzIxMjYwOTAyMTQzNjAxWjCBkTElMCMGCgmSJomT8ixkAQEMFXBhc3Mub3Jn
LmV4YW1wbGUudGVzdDEsMCoGA1UEAwwjUGFzcyBUeXBlIElEOiBwYXNzLm9yZy5l
eGFtcGxlLnRlc3QxEzARBgNVBAsMClRFU1RURUFNMDExGDAWBgNVBAoMD05FUyBX
YWxsZXQgVEVTVDELMAkGA1UEBhMCUEwwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAw
ggEKAoIBAQDhsDQP9yi8Ij9NaMWIWj232ko4vGdylJhZaJDmFROoDqpnkVGAo821
Ump3KdqkzobmDiSoRQypPp2Lrv2pJLjgsG0ffr4HubM26hbVt7v59TntprwPCVIo
f2h8RyqYxmsMfMpDqB4aOOeU18RSy7QMXqGTJ662FuyX33ej3r6wWXqdQRiRa7bH
co46Bt6K4WDLj1tbWsHWJ2cVnFs4wWpWcjBVX/RSK49Bc0qVsDCY/mPE4aiaG5uI
hh17caxmqtA6kiuZgJcjidN8fl+02PL3RxwW3OnII0nJSEynjn2BuGPXY2MHyAsB
82zd2SPviMx2inrx9YCPfxk8o78x35f5AgMBAAGjbzBtMAkGA1UdEwQCMAAwCwYD
VR0PBAQDAgeAMBMGA1UdJQQMMAoGCCsGAQUFBwMDMB0GA1UdDgQWBBSKvdaHnLOO
AXGlZkI16Ik0zrDDGzAfBgNVHSMEGDAWgBTDByaqnV4Lgfr+R5GGKp92i1NXJDAN
BgkqhkiG9w0BAQsFAAOCAQEAjLk4EKLiJtO0aVGEp0x1WJzcV85a065T5Q6Zi+ef
2Gp53wGtORTMCYUwdNcPfBwjJMiX1+ZLw63ngGtXnZfC1Qk1YzBy4HMCB2xDLy51
ETtFEsB0dtCZV4YbRbAUhfpVXOIg0YPvd5LsvMDf8+P8MgmtLXkxBROEeQVnglb6
B7Kty9eke5UlLCRA9oe6yltnIn+YkZBXWcb4/rTjLT1++4gdAZRvfkU7XzXBS6x7
0mIq+q4tgUCYgIam0Zze0IZi1Nt6qdJ/BNz/0gun8an1RMZ190uQgnlRTSmNr7We
neynrcrPqUp1VYPwzDlf/B5rzmHSipWRNhUyfglkBdD6yQ==
-----END CERTIFICATE-----`;

/** Klucz prywatny podpisującego - PKCS#8 (`BEGIN PRIVATE KEY`). */
export const TEST_SIGNER_KEY_PKCS8_PEM = `-----BEGIN PRIVATE KEY-----
MIIEvAIBADANBgkqhkiG9w0BAQEFAASCBKYwggSiAgEAAoIBAQDhsDQP9yi8Ij9N
aMWIWj232ko4vGdylJhZaJDmFROoDqpnkVGAo821Ump3KdqkzobmDiSoRQypPp2L
rv2pJLjgsG0ffr4HubM26hbVt7v59TntprwPCVIof2h8RyqYxmsMfMpDqB4aOOeU
18RSy7QMXqGTJ662FuyX33ej3r6wWXqdQRiRa7bHco46Bt6K4WDLj1tbWsHWJ2cV
nFs4wWpWcjBVX/RSK49Bc0qVsDCY/mPE4aiaG5uIhh17caxmqtA6kiuZgJcjidN8
fl+02PL3RxwW3OnII0nJSEynjn2BuGPXY2MHyAsB82zd2SPviMx2inrx9YCPfxk8
o78x35f5AgMBAAECggEABhmfoxDV+2rrHIvMebFKusQovmqeIdptkjH6g8H7ThYt
K33MbRn5OV3uTDNAr7SxIfW7WSPhiR3FwusOGHsDOrDWiHWssudP/Xt9S4QT4wL4
xesKhaxpNiMfdkB6Z8UNoHKAl4HkK0p/dbRmoABHaRAuZw5VsWlF/X9WSDvIGj40
x2NkYT51HouVwQCO43zpehSBohJoV0whX2SH0QX1lk9XUhU2q/TWHSsLGpId4dYX
9yLzh7ODGrR94Kk/RYtmcVFoej8UY24upcEl33UwmFqVTW2eYsxVvRu06YiNgamj
gkhdQgBaFz4L3FASqly+74PXlmTIG1criAIYmoV7SQKBgQD+r1M4K18JjU3xI2QW
M+6sZoGw7aFvAyU/vNXdHrKc3mTasUFu/7wCz3lKNnO+kGrN5uwVhf3xncR7txE7
OLEkugWF3p7b+LfAZAhOwIqkfKpaFsr+rze5zDCA7Sj01wDQ9iacVq0Bgd3Fg8mV
Puw18Cb5N+eYGEBVGrDqN9wrXQKBgQDi2owDplPz1yp4uq0r8F49fRHySJe2FmQE
VGGrCh7uxA45EcGdP1201GdUyXVFvr8lgpY/eeZK8caZDL0jDH6EZveKfWeTo8f4
l+qsyYDGvKHE8fmFfPfI+kZR75OnYuDE4wnDUrPaX5aKxfx3yO+UT7pvt1HAduZr
SqsmdeTxTQKBgAYc5S1y9QwApT9FbzCNPIxMxY4elgJZG/rEqIlvJDBZsigBmyVz
4+pZWnrqhaqsQrQAd+goWCkFdWLWyQYX3UCZamqFJmD3PknS3NQvEOTTzS7uXx7v
y7Gc8gkWKCaARpe9YL3d4rcni9Ai0qLPaNH+mqDes6NV6a1hP5/PiWxNAoGAQPtj
giQiBkZLRzwKIP0AsdJi0qlSs/kj+02EkK8cfz6v6E8azAV7vTHey53NtwXV0VPf
4Bz2B9/MCMlqYGDS2PB51jTn95XB0YcK1SX/em5MVJMP69oJTIvMmunqvNcJFb0H
bekB1frtr6DZGiL35d8Uw62agGxOwssnzaOVyj0CgYACrttiT87LlMMpSOz4plNO
3c373ZJpaLc1/4B4XIN0yTWW9ksTaTPYv90sRiGWA09wAO/kU82pSgJftLqO/pRI
4L7ncJaK/ZPFuhJr+eM/V7PMbso9THTT19HDkKdbjnZU2vzky+b+lfqPTaxZcIq4
WUCzlr4nqguiJhktV8dP9Q==
-----END PRIVATE KEY-----`;

/** Ten sam klucz w PKCS#1 (`BEGIN RSA PRIVATE KEY`). */
export const TEST_SIGNER_KEY_PKCS1_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEogIBAAKCAQEA4bA0D/covCI/TWjFiFo9t9pKOLxncpSYWWiQ5hUTqA6qZ5FR
gKPNtVJqdynapM6G5g4kqEUMqT6di679qSS44LBtH36+B7mzNuoW1be7+fU57aa8
DwlSKH9ofEcqmMZrDHzKQ6geGjjnlNfEUsu0DF6hkyeuthbsl993o96+sFl6nUEY
kWu2x3KOOgbeiuFgy49bW1rB1idnFZxbOMFqVnIwVV/0UiuPQXNKlbAwmP5jxOGo
mhubiIYde3GsZqrQOpIrmYCXI4nTfH5ftNjy90ccFtzpyCNJyUhMp459gbhj12Nj
B8gLAfNs3dkj74jMdop68fWAj38ZPKO/Md+X+QIDAQABAoIBAAYZn6MQ1ftq6xyL
zHmxSrrEKL5qniHabZIx+oPB+04WLSt9zG0Z+Tld7kwzQK+0sSH1u1kj4YkdxcLr
Dhh7Azqw1oh1rLLnT/17fUuEE+MC+MXrCoWsaTYjH3ZAemfFDaBygJeB5CtKf3W0
ZqAAR2kQLmcOVbFpRf1/Vkg7yBo+NMdjZGE+dR6LlcEAjuN86XoUgaISaFdMIV9k
h9EF9ZZPV1IVNqv01h0rCxqSHeHWF/ci84ezgxq0feCpP0WLZnFRaHo/FGNuLqXB
Jd91MJhalU1tnmLMVb0btOmIjYGpo4JIXUIAWhc+C9xQEqpcvu+D15ZkyBtXK4gC
GJqFe0kCgYEA/q9TOCtfCY1N8SNkFjPurGaBsO2hbwMlP7zV3R6ynN5k2rFBbv+8
As95SjZzvpBqzebsFYX98Z3Ee7cROzixJLoFhd6e2/i3wGQITsCKpHyqWhbK/q83
ucwwgO0o9NcA0PYmnFatAYHdxYPJlT7sNfAm+TfnmBhAVRqw6jfcK10CgYEA4tqM
A6ZT89cqeLqtK/BePX0R8kiXthZkBFRhqwoe7sQOORHBnT9dtNRnVMl1Rb6/JYKW
P3nmSvHGmQy9Iwx+hGb3in1nk6PH+JfqrMmAxryhxPH5hXz3yPpGUe+Tp2LgxOMJ
w1Kz2l+WisX8d8jvlE+6b7dRwHbma0qrJnXk8U0CgYAGHOUtcvUMAKU/RW8wjTyM
TMWOHpYCWRv6xKiJbyQwWbIoAZslc+PqWVp66oWqrEK0AHfoKFgpBXVi1skGF91A
mWpqhSZg9z5J0tzULxDk080u7l8e78uxnPIJFigmgEaXvWC93eK3J4vQItKiz2jR
/pqg3rOjVemtYT+fz4lsTQKBgED7Y4IkIgZGS0c8CiD9ALHSYtKpUrP5I/tNhJCv
HH8+r+hPGswFe70x3sudzbcF1dFT3+Ac9gffzAjJamBg0tjwedY05/eVwdGHCtUl
/3puTFSTD+vaCUyLzJrp6rzXCRW9B23pAdX67a+g2Roi9+XfFMOtmoBsTsLLJ82j
lco9AoGAAq7bYk/Oy5TDKUjs+KZTTt3N+92SaWi3Nf+AeFyDdMk1lvZLE2kz2L/d
LEYhlgNPcADv5FPNqUoCX7S6jv6USOC+53CWiv2TxboSa/njP1ezzG7KPUx009fR
w5CnW452VNr85Mvm/pX6j02sWXCKuFlAs5a+J6oLoiYZLVfHT/U=
-----END RSA PRIVATE KEY-----`;

/** Klucz publiczny podpisującego (SPKI) - do weryfikacji podpisów WebCrypto. */
export const TEST_SIGNER_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA4bA0D/covCI/TWjFiFo9
t9pKOLxncpSYWWiQ5hUTqA6qZ5FRgKPNtVJqdynapM6G5g4kqEUMqT6di679qSS4
4LBtH36+B7mzNuoW1be7+fU57aa8DwlSKH9ofEcqmMZrDHzKQ6geGjjnlNfEUsu0
DF6hkyeuthbsl993o96+sFl6nUEYkWu2x3KOOgbeiuFgy49bW1rB1idnFZxbOMFq
VnIwVV/0UiuPQXNKlbAwmP5jxOGomhubiIYde3GsZqrQOpIrmYCXI4nTfH5ftNjy
90ccFtzpyCNJyUhMp459gbhj12NjB8gLAfNs3dkj74jMdop68fWAj38ZPKO/Md+X
+QIDAQAB
-----END PUBLIC KEY-----`;

/** Samopodpisany TEST CA (v3) w roli certyfikatu pośredniego WWDR. */
export const TEST_WWDR_CERT_PEM = `-----BEGIN CERTIFICATE-----
MIIDgzCCAmugAwIBAgIUIp4MLDOHL1+fZRdZb+9UMxXxaecwDQYJKoZIhvcNAQEL
BQAwUDEnMCUGA1UEAwweTkVTIFdhbGxldCBURVNUIENBIC0gTk9UIEFQUExFMSUw
IwYDVQQKDBxOZXcgRXVyb3BlYW4gU3RyYXRlZ2llcyBURVNUMCAXDTI2MDkyNjE0
MzU1MFoYDzIxMjYwOTAyMTQzNTUwWjBQMScwJQYDVQQDDB5ORVMgV2FsbGV0IFRF
U1QgQ0EgLSBOT1QgQVBQTEUxJTAjBgNVBAoMHE5ldyBFdXJvcGVhbiBTdHJhdGVn
aWVzIFRFU1QwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQCptH79zKWY
ZrQzNmDQt/2SAszI03kA4xa7QbYL0v8X5psJ5YcXA+HJUpxxjqEtysQfRcnXPa1G
8g/GOeUkq7hSibx2Sq6D/Iku/ar3KJhYbTc29VEq36TfIcQbvq+jqbBX8ckZsMjN
qS5ooBreALFV1lhNVTpvi6OfJtrvoUT/HArbV73XK3fxYKff0QRwouzv9Ab6Nmve
xRWQ6BeCaOjj9fHFdPOG2AiWGOkjCsomu9jAiAE9DdaHdNKhKf8Y0xYEDQ3Pis+T
06e8SCgipPqufsHnLv12MAhFms7Jd3knJq6R4UjFOexxmHg0V56H14GfZMG1+RGp
D2tENJGhrHBXAgMBAAGjUzBRMB0GA1UdDgQWBBTDByaqnV4Lgfr+R5GGKp92i1NX
JDAfBgNVHSMEGDAWgBTDByaqnV4Lgfr+R5GGKp92i1NXJDAPBgNVHRMBAf8EBTAD
AQH/MA0GCSqGSIb3DQEBCwUAA4IBAQA9I79yM2cLGHTjVlqbfncciabwDMWt8vrx
dOWjK5lFmF8rpe2vScXztgTe/FzPEfqRxEyj+6mL1DMtqtvuWqABOJx99OAq5fiW
15ktN49150h25BSPRdKJhRt3DZugiUvdgY47tbbqxBthGcadbxP+mwqOtHTp6bvb
6S0JLpZ99UROv68TA1ezMMaW44V9023cb7AOcirlvwnAIFWZyx/M1FGT8IQY2zqQ
qp9qLP2nic3lWdCprGYzH/Mw908x+JCCfhei/QMYduThWIhfi7gZE4PevVIFpCMa
FEldxhRVk1TKKry5NllsENIyDR92jWNUGnLvvUPLPgy35yDi/HbL
-----END CERTIFICATE-----`;

/** Numer seryjny podpisującego (hex, bez wiodącego zera). */
export const TEST_SIGNER_SERIAL_HEX = "8f1e2d3c4b5a69788796a5b4c3d2e1f0";
