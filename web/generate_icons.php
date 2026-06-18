<?php
/**
 * Uygulama ikonlarini uretir (PHP GD ile, harici arac gerekmez).
 * Calistirmak icin:  php generate_icons.php
 * Marka rengini degistirmek istersen asagidaki RGB degerlerini guncelle.
 */

$OUT = __DIR__ . '/icons';
if (!is_dir($OUT)) mkdir($OUT, 0775, true);

// Marka renkleri (sky / brand)
$top = [14, 165, 233];   // #0ea5e9 brand-500
$bot = [3, 105, 161];    // #0369a1 brand-700

function rounded_rect($img, $x1, $y1, $x2, $y2, $r, $color)
{
    imagefilledrectangle($img, $x1 + $r, $y1, $x2 - $r, $y2, $color);
    imagefilledrectangle($img, $x1, $y1 + $r, $x2, $y2 - $r, $color);
    imagefilledellipse($img, $x1 + $r, $y1 + $r, $r * 2, $r * 2, $color);
    imagefilledellipse($img, $x2 - $r, $y1 + $r, $r * 2, $r * 2, $color);
    imagefilledellipse($img, $x1 + $r, $y2 - $r, $r * 2, $r * 2, $color);
    imagefilledellipse($img, $x2 - $r, $y2 - $r, $r * 2, $r * 2, $color);
}

function make_icon($size, $file, $top, $bot, $markScale)
{
    $img = imagecreatetruecolor($size, $size);
    imagealphablending($img, true);
    imagesavealpha($img, true);

    // Dikey gradyen arka plan
    for ($y = 0; $y < $size; $y++) {
        $t = $y / max(1, $size - 1);
        $r = (int) round($top[0] + ($bot[0] - $top[0]) * $t);
        $g = (int) round($top[1] + ($bot[1] - $top[1]) * $t);
        $b = (int) round($top[2] + ($bot[2] - $top[2]) * $t);
        $col = imagecolorallocate($img, $r, $g, $b);
        imagefilledrectangle($img, 0, $y, $size, $y, $col);
    }

    // Beyaz cubuk-grafik amblemi (logoyla uyumlu)
    $white = imagecolorallocatealpha($img, 255, 255, 255, 0);
    $area = $size * $markScale;          // amblem alani
    $off = ($size - $area) / 2;
    $bars = 4;
    $gap = $area * 0.08;
    $barW = ($area - $gap * ($bars - 1)) / $bars;
    $baseline = $off + $area * 0.92;
    $heights = [0.42, 0.62, 0.80, 1.0];  // artan yukseklikler
    $radius = max(2, (int) round($barW * 0.22));
    for ($i = 0; $i < $bars; $i++) {
        $h = $area * 0.78 * $heights[$i];
        $x1 = (int) round($off + $i * ($barW + $gap));
        $x2 = (int) round($x1 + $barW);
        $y1 = (int) round($baseline - $h);
        $y2 = (int) round($baseline);
        rounded_rect($img, $x1, $y1, $x2, $y2, $radius, $white);
    }

    imagepng($img, $file);
    imagedestroy($img);
    echo "olusturuldu: $file\n";
}

make_icon(512, "$OUT/icon-512.png", $top, $bot, 0.56);
make_icon(192, "$OUT/icon-192.png", $top, $bot, 0.56);
make_icon(180, "$OUT/apple-touch-icon.png", $top, $bot, 0.56);
make_icon(512, "$OUT/icon-maskable-512.png", $top, $bot, 0.42); // maskable: daha cok bosluk
echo "Tamamlandi.\n";
