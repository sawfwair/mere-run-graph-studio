fn main() {
    let arguments: Vec<_> = std::env::args_os().skip(1).collect();
    if arguments
        .first()
        .is_some_and(|argument| argument == "--verify-local-package")
    {
        if arguments.len() != 3 {
            eprintln!("Usage: mere-graph-studio --verify-local-package RUNTIME ISOLATED_APP_DATA");
            std::process::exit(2);
        }
        match mere_graph_studio_desktop::verify_local_package(
            arguments[1].clone().into(),
            arguments[2].clone().into(),
        ) {
            Ok(result) => println!("{result}"),
            Err(reason) => {
                eprintln!("{reason}");
                std::process::exit(1);
            }
        }
        return;
    }
    mere_graph_studio_desktop::run();
}
