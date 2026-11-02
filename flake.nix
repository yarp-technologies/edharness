{
  description = "OpenCode development flake";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
    nix-bun.url = "github:ryoppippi/nix-bun/75a3e6f79693130abc113ddf0cfd300f0fe31105";
  };

  outputs =
    { self, nixpkgs, nix-bun, ... }:
    let
      systems = [
        "aarch64-linux"
        "x86_64-linux"
        "aarch64-darwin"
      ];
      forEachSystem = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});
      rev = self.shortRev or self.dirtyShortRev or "dirty";
    in
    {
      devShells = forEachSystem (pkgs: {
        default = pkgs.mkShell {
          packages = with pkgs; [
            nix-bun.packages.${pkgs.stdenv.hostPlatform.system}."1.4.4"
            nodejs
            pkg-config
            openssl
            git
          ];
        };
      });

      overlays = {
        default =
          final: _prev:
          let
            node_modules = final.callPackage ./nix/node_modules.nix {
              inherit rev;
            };
          in
          rec {
            opencode = final.callPackage ./nix/opencode.nix {
              inherit node_modules;
            };
            opencode-desktop = final.callPackage ./nix/desktop.nix {
              inherit opencode;
            };
          };
      };

      packages = forEachSystem (
        pkgs:
        let
          node_modules = pkgs.callPackage ./nix/node_modules.nix {
            inherit rev;
          };
        in
        rec {
          default = opencode;
          opencode = pkgs.callPackage ./nix/opencode.nix {
            inherit node_modules;
          };
          opencode-desktop = pkgs.callPackage ./nix/desktop.nix {
            inherit opencode;
          };
          # Updater derivation with fakeHash - build fails and reveals correct hash
          node_modules_updater = node_modules.override {
            hash = pkgs.lib.fakeHash;
          };
        }
      );
    };
}
